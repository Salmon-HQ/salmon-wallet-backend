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

const PROVIDER = { id: 'jupiter', displayName: 'Jupiter', attribution: 'Powered by Jupiter' };
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

const upstreamReason = (data) => (data && (data.error || data.message)) || 'No route available';

/**
 * Translate a Jupiter 4xx into the public envelope. Jupiter answers 400 for
 * both a pair it cannot route (`No routes found`) and a fee account it will
 * not accept (`Invalid feeAccount`); the second is our configuration.
 */
const toSwapError = (status, data) => {
  const reason = upstreamReason(data);
  if (/fee/i.test(reason)) {
    console.error('[SWAP_MISCONFIGURED] Jupiter rejected our own request parameters', data);
    return new SolanaSwapError(reason, 500, 'swap_misconfigured');
  }
  if (status === 400 || status === 404 || status === 422) {
    return new SolanaSwapNoRouteError(reason);
  }
  return null;
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
    const mapped = status ? toSwapError(status, error.response.data) : null;
    if (mapped) {
      console.warn('Jupiter swap build rejected the request:', error.response.data);
      throw mapped;
    }
    throw error;
  }

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

module.exports = { requestSwapInstructions, isConfigured, PROVIDER, FEE };
