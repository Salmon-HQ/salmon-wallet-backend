'use strict';

/**
 * Bitcoin transaction service.
 *
 * Handles transaction history reads for Bitcoin via Blockdaemon.
 * First-page history requests are cached; paginated requests always hit
 * upstream.
 */

const http = require('axios');
const blockdaemonClient = require('../../infrastructure/blockdaemon-client');
const { clampPageSize, READ_TIMEOUT } = require('./page-size');
const {
  buildCacheKey,
  isFirstPageQuery,
  withCachedTransactionHistory,
} = require('../../infrastructure/cache/transaction-history-cache');

/**
 * Decorates each upstream transaction item with the requesting
 * `address` and (when provided) `blockchain`.
 *
 * @param {Array<Object>} items - raw items from Blockdaemon.
 * @param {string} address - requested account address.
 * @param {string} [blockchain] - value of `locals.network.blockchain`;
 *   omitted from output when falsy.
 * @returns {Array<Object>} items with `address` (+ optional `blockchain`) added.
 */
const mapAddressItems = (items, address, blockchain) =>
  items.map((item) => ({
    ...item,
    ...(blockchain ? { blockchain } : {}),
    address,
  }));

/**
 * Fetches one page of an account's transaction history from
 * Blockdaemon's universal `/account/:address/txs` endpoint, always
 * hitting upstream (no cache).
 *
 * @param {string} address - account address to query.
 * @param {{pageToken?: string, pageSize?: number}} filters
 *   - `pageToken` maps to Blockdaemon's `continuation` cursor;
 *   `pageSize` maps to `limit`.
 * @param {{network: {blockchain: string, environment: string}}} locals
 *   - per-request locals used to build the upstream URL.
 * @returns {Promise<{data: Array<Object>, meta: {nextPageToken?: string}}>}
 *   history page, items decorated with `address` + `blockchain`.
 */
const fetchTransactions = async (address, filters, locals) => {
  const { pageToken, pageSize } = filters;

  const { blockchain } = locals.network;
  const url = blockdaemonClient.getUniversalUrl(locals, `/account/${address}/txs`);
  const params = {
    order: 'desc',
  };
  if (pageToken) {
    params.continuation = pageToken;
  }
  if (pageSize) {
    params.limit = clampPageSize(pageSize);
  }

  const { data } = await http.get(
    url,
    blockdaemonClient.getRequestConfig({ params, timeout: READ_TIMEOUT })
  );

  return {
    data: mapAddressItems(data.data, address, blockchain),
    meta: {
      nextPageToken: data.meta?.paging?.next_page_token,
    },
  };
};

/**
 * Fetches an account's transaction history, transparently caching
 * first-page requests (see `withCachedTransactionHistory`) for
 * `CACHE_TTL`. Paginated requests (any `filters` beyond the first page)
 * always hit upstream.
 *
 * @param {string} address - account address to query.
 * @param {{pageToken?: string, pageSize?: number}} filters - see `fetchTransactions`.
 * @param {{network: {blockchain: string, environment: string, id?: string}}} locals
 *   - per-request locals; `network.id` is used in the cache key.
 * @returns {Promise<{data: Array<Object>, meta: {nextPageToken?: string}}>}
 *   history page, deep-cloned when served from cache.
 */
const getTransactions = async (address, filters, locals) => {
  const loadTransactions = () => fetchTransactions(address, filters, locals);

  if (!isFirstPageQuery(filters)) {
    return loadTransactions();
  }

  return withCachedTransactionHistory(
    buildCacheKey('bitcoin-transactions', address, filters, locals),
    loadTransactions
  );
};

module.exports = {
  getTransactions,
};
