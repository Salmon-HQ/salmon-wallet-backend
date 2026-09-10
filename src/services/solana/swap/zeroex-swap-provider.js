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
/** DEX labels (from `GET /enabled-sources`) to exclude from routing, e.g. `PumpFun,PumpSwap`. */
const DISABLED_SOURCES = (process.env.ZEROEX_DISABLED_SOURCES || '')
  .split(',')
  .map((label) => label.trim())
  .filter(Boolean);

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
 * 0x error `code`s observed live (2026-09-10) and their public mapping.
 * Anything else on a 4xx is "this provider cannot serve this swap".
 */
const ZEROEX_ERROR_MAP = {
  // Caller input the controller should already have refused.
  NULL_AMOUNT_IN: [400, 'invalid_parameter'],
  INVALID_PUBKEY: [400, 'invalid_parameter'],
  INPUT_OUTPUT_SAME_TOKEN: [400, 'invalid_parameter'],
  INVALID_SLIPPAGE: [400, 'invalid_parameter'],
  INVALID_REQUEST_BODY: [400, 'invalid_parameter'],
  // The pair itself: unknown mint, Token-2022 with transfer fee/hook, or a
  // token 0x will not trade for legal reasons.
  TOKEN_NOT_FOUND: [422, 'token_not_supported'],
  TOKEN_HAS_UNSUPPORTED_EXTENSIONS: [422, 'token_not_supported'],
  BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE: [422, 'token_not_supported'],
  SELL_TOKEN_NOT_AUTHORIZED_FOR_TRADE: [422, 'token_not_supported'],
  // 0x's own sanctions screening of the taker.
  TAKER_NOT_AUTHORIZED_FOR_TRADE: [403, 'wallet_restricted'],
  // Our configuration (fee, disabled sources), never the caller's fault.
  INVALID_SOURCE: [500, 'swap_misconfigured'],
  ALL_SOURCES_DISABLED: [500, 'swap_misconfigured'],
  INVALID_SWAP_FEE_PPM: [500, 'swap_misconfigured'],
  INCOMPLETE_SWAP_FEE: [500, 'swap_misconfigured'],
  INVALID_SWAP_FEE_RECIPIENT: [500, 'swap_misconfigured'],
};

/** Translate a 0x 4xx into the public error envelope; the 0x code rides in the message. */
const toSwapError = (status, data) => {
  const code = data?.code;
  const reason = code ? `${upstreamReason(data)} (${code})` : upstreamReason(data);
  const mapped = ZEROEX_ERROR_MAP[code];
  if (mapped) {
    if (mapped[0] === 500) {
      console.error('[SWAP_MISCONFIGURED] 0x rejected our own request parameters', data);
    }
    return new SolanaSwapError(reason, mapped[0], mapped[1]);
  }
  if (status === 403) {
    return new SolanaSwapError(reason, 403, 'wallet_restricted');
  }
  return new SolanaSwapNoRouteError(reason);
};

/**
 * Request swap instructions from 0x.
 *
 * @param {Object} params
 * @param {string} params.inputMint
 * @param {string} params.outputMint
 * @param {string} params.amount - input amount in base units.
 * @param {string} params.taker - user's public key (signer + fee payer).
 * @param {number} params.slippageBps
 * @param {{ recipient: string, bps: number, side: 'buy'|'sell' }|null} params.fee - Salmon's
 *   fee: `buy` takes it from the output token, `sell` from the input token. `recipient` must
 *   already exist (token account, or wallet for native SOL).
 * @param {number} params.reserveBytes - bytes 0x must leave free for instructions we add.
 * @returns {Promise<{ instructions: TransactionInstruction[], lookupTableAddresses: string[],
 *   amountOut: string, minAmountOut: string, routePlan: Object[], zid: string }>}
 * @throws {SolanaSwapError} on a 0x 4xx, mapped per `ZEROEX_ERROR_MAP`.
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
          swap_fee_side: fee.side,
        }
      : {}),
    ...(DISABLED_SOURCES.length > 0 ? { disabled_sources: DISABLED_SOURCES } : {}),
  };

  let data;
  try {
    ({ data } = await withRetry(
      () =>
        http.post(`${ZEROEX_API_URL}/swap-instructions`, body, {
          timeout: REQUEST_TIMEOUT,
          headers: headers(),
        }),
      { operationName: `0x swap-instructions (${inputMint} → ${outputMint})` }
    ));
  } catch (error) {
    const status = error.response?.status;
    // 0x answers 4xx with `{ code, error, zid }`: 400 for bad input or bad
    // integrator config, 422 for a pair it cannot serve, 403 when its own
    // sanctions screening refuses the taker. `ZEROEX_ERROR_MAP` turns the
    // code into our envelope; unknown codes mean "no route here". withRetry
    // only retries 429/5xx/network, so these arrive here on the first try.
    if (status === 400 || status === 403 || status === 422) {
      console.warn('0x swap-instructions rejected the request:', error.response.data);
      throw toSwapError(status, error.response.data);
    }
    if (status === 429) {
      throw new SolanaSwapError(
        '0x rate limit exceeded; retry shortly',
        503,
        'upstream_rate_limited'
      );
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
};

module.exports = { requestSwapInstructions, PPM_PER_BPS, ZEROEX_NATIVE_SOL, ZEROEX_ERROR_MAP };
