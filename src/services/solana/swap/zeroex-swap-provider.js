'use strict';

/**
 * 0x Solana Swap API adapter (`POST /solana/swap-instructions`).
 *
 * 0x returns quote numbers plus a flat, ordered list of raw instructions and
 * the addresses of the lookup tables they need — never a serialized or
 * signed transaction. This module owns the 0x wire format (snake_case body,
 * byte-array instructions, ppm fees) and hands back web3.js instructions;
 * assembling the transaction is `solana-swap-build-service`.
 *
 * Docs: https://docs.0x.org/api-reference/solana-swap-ap-is/swap/instructions
 */

const http = require('axios');
const { PublicKey, TransactionInstruction } = require('@solana/web3.js');
const {
  withRetry,
  rateLimiter,
} = require('../../../infrastructure/rate-limiting/zeroex-rate-limiter');
const { SolanaSwapNoRouteError } = require('./solana-swap-errors');

const ZEROEX_API_URL = process.env.ZEROEX_API_URL || 'https://api.0x.org/solana';
const REQUEST_TIMEOUT = 10000;
/** 0x fees are parts per million; 1 bps = 100 ppm. */
const PPM_PER_BPS = 100;

const headers = () => ({
  'Content-Type': 'application/json',
  '0x-api-key': process.env.ZEROEX_API_KEY || '',
});

const toInstruction = (raw) =>
  new TransactionInstruction({
    programId: new PublicKey(Uint8Array.from(raw.program_id)),
    keys: raw.accounts.map((account) => ({
      pubkey: new PublicKey(Uint8Array.from(account.pubkey)),
      isSigner: account.is_signer,
      isWritable: account.is_writable,
    })),
    data: Buffer.from(raw.data),
  });

/**
 * Human-readable reason from either 0x envelope: the API's `{ code, error }`
 * or the gateway's `{ message }`.
 */
const upstreamReason = (data) => (data && (data.error || data.message)) || 'No route available';

/**
 * Request swap instructions from 0x.
 *
 * @param {Object} params
 * @param {string} params.inputMint
 * @param {string} params.outputMint
 * @param {string} params.amount - input amount in base units.
 * @param {string} params.taker - user's public key (signer + fee payer).
 * @param {number} params.slippageBps
 * @param {{ recipient: string, bps: number }|null} params.fee - Salmon's fee, taken from the
 *   output token (`buy` side). `recipient` must already exist (token account, or wallet for SOL).
 * @param {number} params.reserveBytes - bytes 0x must leave free for instructions we add.
 * @returns {Promise<{ instructions: TransactionInstruction[], lookupTableAddresses: string[],
 *   amountOut: string, minAmountOut: string, routePlan: Object[], zid: string }>}
 * @throws {SolanaSwapNoRouteError} on a 0x 400 (no route / unsupported pair / bad amount).
 */
const requestSwapInstructions = async ({
  inputMint,
  outputMint,
  amount,
  taker,
  slippageBps,
  fee,
  reserveBytes,
}) => {
  await rateLimiter.waitAndConsume();

  const body = {
    token_in: inputMint,
    token_out: outputMint,
    amount_in: Number(amount),
    taker,
    slippage_bps: slippageBps,
    reserve_transaction_bytes: reserveBytes,
    ...(fee
      ? {
          swap_fee_ppm: String(fee.bps * PPM_PER_BPS),
          swap_fee_recipient: fee.recipient,
          swap_fee_side: 'buy',
        }
      : {}),
  };

  return withRetry(
    async () => {
      let data;
      try {
        ({ data } = await http.post(`${ZEROEX_API_URL}/swap-instructions`, body, {
          timeout: REQUEST_TIMEOUT,
          headers: headers(),
        }));
      } catch (error) {
        if (error.response?.status === 400) {
          console.warn('0x swap-instructions rejected the request:', error.response.data);
          throw new SolanaSwapNoRouteError(upstreamReason(error.response.data));
        }
        throw error;
      }

      return {
        instructions: data.instructions.map(toInstruction),
        lookupTableAddresses: data.address_lookup_tables || [],
        amountOut: String(data.amount_out),
        minAmountOut: String(data.min_amount_out),
        routePlan: data.route_plan || [],
        zid: data.zid,
      };
    },
    { operationName: `0x swap-instructions (${inputMint} → ${outputMint})` }
  );
};

module.exports = { requestSwapInstructions, PPM_PER_BPS };
