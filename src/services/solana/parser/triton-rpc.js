'use strict';

/**
 * Triton RPC fetcher — wraps `getSignaturesForAddress` and
 * `getParsedTransactions` over Triton's JSON-RPC endpoint.
 *
 * We use raw axios POSTs (not the web3 Connection) for two reasons:
 *
 *   1. The Connection class doesn't take an Authorization header cleanly,
 *      and Triton uses URL-embedded tokens that we already centralize in
 *      `triton-client.getRpcUrl()`. axios + URL = identical to Helius
 *      transaction-service.
 *   2. We want batched `getTransaction` calls (one HTTP request, multiple
 *      JSON-RPC envelopes) for performance. Connection batches with a
 *      private API; axios with an array payload is documented and works
 *      against any Solana-compatible RPC.
 *
 * Returns the raw RPC response with `result` unwrapped — the parser
 * orchestrator consumes that shape directly.
 */

const axios = require('axios');
const tritonClient = require('../../../infrastructure/triton-client');

const DEFAULT_COMMITMENT = 'confirmed';
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TX_VERSION = 0;
const DEFAULT_HISTORY_LIMIT = 10;

const buildRequest = (id, method, params) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
});

const post = async (environment, body) => {
  const url = tritonClient.getRpcUrl(environment);
  const { data } = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  return data;
};

/**
 * Page transaction signatures touching `address`. Wraps Solana RPC
 * `getSignaturesForAddress`.
 * @param {string} address
 * @param {{before?: string, until?: string, limit?: number}} [options]
 * @param {string} [environment='mainnet']
 * @returns {Promise<Array<{signature: string, slot: number, blockTime: number|null, err: object|null}>>}
 * @throws {Error} With `code = 'TRITON_RPC_ERROR'` and `rpcError` populated
 *   when the JSON-RPC envelope returns an `error`. Axios HTTP/network failures
 *   propagate without `code` set — callers should treat unset `code` as a
 *   transport-level failure.
 */
const getSignaturesForAddress = async (
  address,
  { before, until, limit } = {},
  environment = 'mainnet'
) => {
  const params = [
    address,
    {
      before,
      until,
      limit: limit ?? 10,
      commitment: DEFAULT_COMMITMENT,
    },
  ];

  const data = await post(
    environment,
    buildRequest('get-signatures', 'getSignaturesForAddress', params)
  );
  if (data?.error) {
    const err = new Error(`getSignaturesForAddress failed: ${data.error.message || 'unknown'}`);
    err.code = 'TRITON_RPC_ERROR';
    err.rpcError = data.error;
    throw err;
  }
  return data?.result || [];
};

/**
 * Fetch a single parsed transaction. Returns `null` if the tx is not found.
 * @param {string} signature
 * @param {string} [environment='mainnet']
 * @returns {Promise<object|null>} Raw `getTransaction` result.
 * @throws {Error} With `code = 'TRITON_RPC_ERROR'` and `rpcError` populated
 *   when the JSON-RPC envelope returns an `error`. Axios HTTP/network failures
 *   propagate without `code` set — callers should treat unset `code` as a
 *   transport-level failure.
 */
const getParsedTransaction = async (signature, environment = 'mainnet') => {
  const params = [
    signature,
    {
      commitment: DEFAULT_COMMITMENT,
      maxSupportedTransactionVersion: MAX_TX_VERSION,
      encoding: 'jsonParsed',
    },
  ];

  const data = await post(environment, buildRequest('get-tx', 'getTransaction', params));
  if (data?.error) {
    const err = new Error(
      `getTransaction failed for ${signature}: ${data.error.message || 'unknown'}`
    );
    err.code = 'TRITON_RPC_ERROR';
    err.rpcError = data.error;
    throw err;
  }
  return data?.result || null;
};

/**
 * Batch-fetch parsed transactions in a single JSON-RPC array request.
 * Indexes by envelope `id` so results stay aligned to input order even if
 * the provider reorders the response. Missing txs become `null`.
 * @param {string[]} signatures
 * @param {string} [environment='mainnet']
 * @returns {Promise<Array<object|null>>} One entry per input signature, in order.
 * @throws {Error} With `code = 'TRITON_RPC_ERROR'` and `rpcError` populated
 *   when the provider rejects the batch with a single error envelope. Axios
 *   HTTP/network failures propagate without `code` set — callers should treat
 *   unset `code` as a transport-level failure.
 */
const getParsedTransactionsBatch = async (signatures, environment = 'mainnet') => {
  if (!signatures || signatures.length === 0) return [];

  // JSON-RPC batch: send an array of envelopes, receive an array of responses.
  // We send numeric `id` values so correlation is `Number(envelope.id) === i`.
  // Order of `result` is not guaranteed to follow request order on every
  // provider — the spec says responses MAY be returned in any order — so we
  // index by id rather than trusting array position.
  const body = signatures.map((sig, i) =>
    buildRequest(i, 'getTransaction', [
      sig,
      {
        commitment: DEFAULT_COMMITMENT,
        maxSupportedTransactionVersion: MAX_TX_VERSION,
        encoding: 'jsonParsed',
      },
    ])
  );

  const data = await post(environment, body);
  if (!Array.isArray(data)) {
    // Some RPC providers reject batch and return a single error envelope.
    if (data?.error) {
      const err = new Error(`getTransaction batch failed: ${data.error.message || 'unknown'}`);
      err.code = 'TRITON_RPC_ERROR';
      err.rpcError = data.error;
      throw err;
    }
    return [];
  }

  const indexed = new Map();
  for (const envelope of data) {
    if (envelope?.id == null) continue;
    // Tolerate string or number — some providers normalize types.
    const idx = typeof envelope.id === 'number' ? envelope.id : Number(envelope.id);
    if (Number.isNaN(idx)) continue;
    indexed.set(idx, envelope.result || null);
  }

  return signatures.map((_, i) => indexed.get(i) ?? null);
};

/**
 * Single-call address history. Wraps Superbank's `getTransactionsForAddress`,
 * which returns signatures + full transactions in one round-trip — collapsing
 * the `getSignaturesForAddress` + `getTransaction` (batch) pair into a single
 * billed RPC method execution.
 *
 * Each returned entry is `getTransaction`-shaped (`{ slot, transaction, meta,
 * blockTime, ... }`), so the parser orchestrator consumes it directly — no
 * separate fetch per signature. `transactionDetails: 'full'` caps at 100 per
 * Triton; we never request more than that here.
 *
 * @param {string} address
 * @param {{limit?: number, sortOrder?: 'asc'|'desc'}} [options]
 * @param {string} [environment='mainnet']
 * @returns {Promise<{transactions: Array<object>, paginationToken: string|null}>}
 *   `transactions` in `sortOrder` order (default newest-first); `paginationToken`
 *   is Triton's opaque `"slot:position"` cursor, or `null` when exhausted.
 * @throws {Error} With `code = 'TRITON_RPC_ERROR'` and `rpcError` populated when
 *   the JSON-RPC envelope returns an `error`. Axios HTTP/network failures
 *   propagate without `code` set — callers should treat unset `code` as a
 *   transport-level failure.
 */
const getTransactionsForAddress = async (
  address,
  { limit, sortOrder = 'desc' } = {},
  environment = 'mainnet'
) => {
  const params = [
    address,
    {
      limit: limit ?? DEFAULT_HISTORY_LIMIT,
      sortOrder,
      commitment: DEFAULT_COMMITMENT,
      maxSupportedTransactionVersion: MAX_TX_VERSION,
      encoding: 'jsonParsed',
      transactionDetails: 'full',
    },
  ];

  const data = await post(
    environment,
    buildRequest('get-txs-for-address', 'getTransactionsForAddress', params)
  );
  if (data?.error) {
    const err = new Error(`getTransactionsForAddress failed: ${data.error.message || 'unknown'}`);
    err.code = 'TRITON_RPC_ERROR';
    err.rpcError = data.error;
    throw err;
  }
  return {
    transactions: data?.result?.data || [],
    paginationToken: data?.result?.paginationToken ?? null,
  };
};

module.exports = {
  getSignaturesForAddress,
  getParsedTransaction,
  getParsedTransactionsBatch,
  getTransactionsForAddress,
};
