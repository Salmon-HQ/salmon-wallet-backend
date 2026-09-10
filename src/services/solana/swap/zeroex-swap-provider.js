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
const { SOL_ADDRESS } = require('../../../constants/solana-constants');
const { SolanaSwapError, SolanaSwapNoRouteError } = require('./solana-swap-errors');

const ZEROEX_API_URL = process.env.ZEROEX_API_URL || 'https://api.0x.org/solana';
const REQUEST_TIMEOUT = 10000;
/** 0x fees are parts per million; 1 bps = 100 ppm. */
const PPM_PER_BPS = 100;
/**
 * 0x's sentinel for NATIVE SOL. Probed live 2026-09-10: with `…111` the
 * user's lamports move directly (no WSOL account for the user, fee to a
 * wallet address works); with the WSOL mint `…112` 0x creates and fills the
 * user's WSOL token account instead. The public contract keeps `SOL_ADDRESS`
 * (`…112`), so it is translated at this boundary only.
 */
const ZEROEX_NATIVE_SOL = 'So11111111111111111111111111111111111111111';

const toZeroexMint = (mint) => (mint === SOL_ADDRESS ? ZEROEX_NATIVE_SOL : mint);

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
    token_in: toZeroexMint(inputMint),
    token_out: toZeroexMint(outputMint),
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
        const status = error.response?.status;
        // 0x answers 400 for a malformed request and 422 for a pair/amount it
        // cannot serve (probed: `{ code: 'TOKEN_NOT_FOUND', error: 'Token not found' }`).
        // Either way the caller's input has no route on this provider.
        if (status === 400 || status === 422) {
          console.warn('0x swap-instructions rejected the request:', error.response.data);
          throw new SolanaSwapNoRouteError(upstreamReason(error.response.data));
        }
        // 0x screens the taker against OFAC/EU/UK/UN lists itself and answers
        // 403 TAKER_NOT_AUTHORIZED_FOR_TRADE (documented for EVM; Solana
        // unverified). Same meaning as spec 011's wallet screening → same code.
        if (status === 403) {
          console.warn('0x refused the taker:', error.response.data);
          throw new SolanaSwapError(upstreamReason(error.response.data), 403, 'wallet_restricted');
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
  ).catch((error) => {
    if (error.response?.status === 429) {
      throw new SolanaSwapError(
        '0x rate limit exceeded; retry shortly',
        503,
        'upstream_rate_limited'
      );
    }
    throw error;
  });
};

module.exports = { requestSwapInstructions, PPM_PER_BPS, ZEROEX_NATIVE_SOL };
