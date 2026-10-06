'use strict';

/**
 * Jupiter Swap API v2 Router adapter (`GET /swap/v2/build`).
 *
 * The Router path returns quote numbers plus instruction groups and the
 * addresses of the lookup tables they need — never a serialized or signed
 * transaction, which is why `/swap/v2/order` + `/execute` (Jupiter assembles
 * and broadcasts) are never used (root `AGENTS.md` "Signing boundary").
 * This module owns Jupiter's wire format (base58 program ids, base64
 * instruction data, `platformFeeBps` + `feeAccount`) and hands back
 * web3.js instructions; assembling the transaction is
 * `solana-swap-build-service`.
 *
 * Jupiter's own compute-budget instructions are dropped: the shared builder
 * prepends its own. Its blockhash is ignored for the same reason. The
 * platform fee is taken from the OUTPUT token on ExactIn, so `feeAccount`
 * must be a token account of the output mint (the owner's wrapped-SOL
 * account for SOL, never the wallet itself), which `FEE` tells the build
 * service. Probed 2026-09-30 with the production key: the Router path
 * charges no Jupiter fee; `x-ratelimit-limit` is 10 per second.
 *
 * Docs: https://dev.jup.ag/docs/swap/v2
 */

const http = require('axios');
const { PublicKey, TransactionInstruction } = require('@solana/web3.js');
const { providerCall } = require('../../../infrastructure/providers/provider-client');
const { SolanaSwapError, SolanaSwapNoRouteError } = require('./solana-swap-errors');

/**
 * `/swap/v2/build` routes through Metis, Jupiter's onchain router. Jupiter's
 * API licence (§2.3) makes it mandatory to state "Metis" prominently to end
 * users and calls labelling the output "Jupiter" alone misleading, so the
 * attribution names the router first.
 */
const PROVIDER = { id: 'jupiter', displayName: 'Metis', attribution: 'Powered by Metis (Jupiter)' };
/** Fee only from the output side, into a token account (wrapped SOL for SOL). */
const FEE = { sides: ['buy'], nativeSolAsWallet: false };
const JUPITER_API_URL = process.env.JUPITER_SWAP_API_URL || 'https://api.jup.ag/swap/v2';

/** The table may name Jupiter for a country only if the credential is there. */
const isConfigured = () => Boolean(process.env.JUPITER_API_KEY);

const headers = () => ({ 'x-api-key': process.env.JUPITER_API_KEY || '' });

const toInstruction = (raw) =>
  new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys: raw.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(raw.data, 'base64'),
  });

/**
 * Jupiter answers a refused build with `{ error: string }`, or with
 * `{ error: { name: 'ZodError', issues } }` when the query shape itself is
 * wrong. Texts observed live on 2026-10-01 against `/swap/v2/build`:
 *   "No routes found"                      — pair, amount or an unknown mint
 *   "inputMint cannot be same as outputMint"
 *   "Invalid inputMint" / "Invalid outputMint" / "Invalid taker" / "Invalid amount"
 *   "Invalid feeAccount" / "feeAccount is required when platformFeeBps is positive"
 *   ZodError on `slippageBps` (> 10000), missing `taker` / `amount`
 * Anything the controller already validates (mints, taker, amount, slippage
 * bounds) can only reach Jupiter through our own bug, and so can a fee
 * account it refuses: those are 500 `swap_misconfigured`, logged. A pair it
 * cannot route is 404 `no_route`.
 */
const JUPITER_ERROR_MAP = [
  [/^No routes found/i, 404, 'no_route'],
  [/cannot be same as/i, 400, 'invalid_parameter'],
  [/^Invalid (inputMint|outputMint|taker|amount)\b/i, 500, 'swap_misconfigured'],
  [/feeAccount/i, 500, 'swap_misconfigured'],
];

/** Human-readable reason from either envelope, the first Zod issue included. */
const upstreamReason = (data) => {
  const error = data?.error;
  if (typeof error === 'string') return error;
  const issue = Array.isArray(error?.issues) ? error.issues[0] : null;
  if (issue) return `${(issue.path || []).join('.') || 'request'}: ${issue.message}`;
  if (typeof data?.message === 'string') return data.message;
  return 'No route available';
};

/** Translate a Jupiter 4xx into the public envelope; null when it is not ours to translate. */
const toSwapError = (status, data) => {
  const reason = upstreamReason(data);
  const misconfigured = (why) => {
    console.error('[SWAP_MISCONFIGURED] Jupiter rejected our own request parameters', {
      why,
      data,
    });
    return new SolanaSwapError(reason, 500, 'swap_misconfigured');
  };
  if (data?.error?.name === 'ZodError') return misconfigured('request shape');
  for (const [pattern, mappedStatus, code] of JUPITER_ERROR_MAP) {
    if (pattern.test(reason)) {
      return mappedStatus === 500
        ? misconfigured(code)
        : new SolanaSwapError(reason, mappedStatus, code);
    }
  }
  if (status === 400 || status === 404 || status === 422) return new SolanaSwapNoRouteError(reason);
  return null;
};

const isInstruction = (raw) =>
  Boolean(raw) &&
  typeof raw.programId === 'string' &&
  Array.isArray(raw.accounts) &&
  typeof raw.data === 'string';

/**
 * A 200 whose shape is not the one this adapter was written against is a
 * provider defect, never signable bytes: a missing swap instruction would
 * otherwise build a transaction that sets accounts up and swaps nothing.
 * @throws {SolanaSwapError} 502 `provider_bad_response`
 */
const assertBuildShape = (data) => {
  const ok =
    Boolean(data) &&
    isInstruction(data.swapInstruction) &&
    /^\d+$/.test(String(data.outAmount)) &&
    /^\d+$/.test(String(data.otherAmountThreshold)) &&
    (data.setupInstructions === undefined || data.setupInstructions.every(isInstruction)) &&
    (data.cleanupInstruction == null || isInstruction(data.cleanupInstruction)) &&
    (data.otherInstructions === undefined || data.otherInstructions.every(isInstruction));
  if (!ok) {
    console.error('[SWAP_PROVIDER_BAD_RESPONSE]', { provider: 'jupiter' });
    throw new SolanaSwapError(
      'Jupiter answered with an unexpected shape',
      502,
      'provider_bad_response'
    );
  }
};

/**
 * Request swap instructions from Jupiter.
 *
 * @param {Object} params
 * @param {string} params.inputMint
 * @param {string} params.outputMint
 * @param {string} params.amount - input amount in base units.
 * @param {string} params.taker - user's public key (signer + fee payer).
 * @param {number} params.slippageBps
 * @param {{ recipient: string, bps: number, side: 'buy' }|null} params.fee - Salmon's fee;
 *   `recipient` is an existing token account of the output mint.
 * @returns {Promise<{ instructions: TransactionInstruction[], lookupTableAddresses: string[],
 *   amountOut: string, minAmountOut: string, routePlan: Array<{ label: string, percent: number }>,
 *   providerRequestId: null, routeFee: null }>}
 * @throws {SolanaSwapError} 404 `no_route`, 500 `swap_misconfigured`, 503 `upstream_rate_limited`.
 */
const requestSwapInstructions = async ({
  inputMint,
  outputMint,
  amount,
  taker,
  slippageBps,
  fee,
}) => {
  const params = {
    inputMint,
    outputMint,
    amount,
    taker,
    slippageBps,
    ...(fee ? { platformFeeBps: fee.bps, feeAccount: fee.recipient } : {}),
  };

  let data;
  try {
    ({ data } = await providerCall(
      'jupiter',
      ({ timeout, signal }) =>
        http.get(`${JUPITER_API_URL}/build`, { params, timeout, signal, headers: headers() }),
      { operationName: `Jupiter swap build (${inputMint} → ${outputMint})` }
    ));
  } catch (error) {
    const status = error.response?.status;
    if (status === 429) {
      throw new SolanaSwapError(
        'Jupiter rate limit exceeded; retry shortly',
        503,
        'upstream_rate_limited'
      );
    }
    if (status === 401 || status === 403) {
      // Our credential, never the caller's wallet: the raw error carries the
      // request headers, so it is replaced rather than rethrown.
      console.error('[SWAP_PROVIDER_AUTH]', { provider: 'jupiter', status });
      throw new SolanaSwapError('Jupiter refused our credentials', 503, 'upstream_unavailable');
    }
    const mapped = status ? toSwapError(status, error.response.data) : null;
    if (mapped) {
      console.warn('Jupiter swap build rejected the request:', error.response.data);
      throw mapped;
    }
    throw error;
  }

  assertBuildShape(data);

  // Order per Jupiter's reference assembly; `computeBudgetInstructions` and
  // `tipInstruction` (Jito) are ours to decide and are left out.
  const instructions = [
    ...(data.setupInstructions || []),
    data.swapInstruction,
    data.cleanupInstruction,
    ...(data.otherInstructions || []),
  ]
    .filter(Boolean)
    .map(toInstruction);

  return {
    instructions,
    lookupTableAddresses: Object.keys(data.addressesByLookupTableAddress || {}),
    amountOut: String(data.outAmount),
    minAmountOut: String(data.otherAmountThreshold),
    routePlan: (data.routePlan || []).map((leg) => ({
      label: leg.swapInfo?.label ?? 'unknown',
      percent: Number(leg.percent),
    })),
    providerRequestId: null,
    routeFee: null,
  };
};

module.exports = { requestSwapInstructions, isConfigured, PROVIDER, FEE, JUPITER_ERROR_MAP };
