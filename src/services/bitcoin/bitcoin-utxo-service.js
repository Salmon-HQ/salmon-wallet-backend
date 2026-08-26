'use strict';

/**
 * Bitcoin UTXO service.
 *
 * Walks Blockdaemon continuation pages and returns the full unspent set in one
 * response, preserving the existing `meta.nextPageToken: null` API contract.
 */

const http = require('axios');
const blockdaemonClient = require('../../infrastructure/blockdaemon-client');
const { clampPageSize, READ_TIMEOUT } = require('./page-size');

// 100 pages x 100 outputs is far past any realistic wallet address.
const MAX_UTXO_PAGES = 100;

/**
 * Decorates each upstream UTXO item with the requesting `address` and
 * (when provided) `blockchain`.
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
 * Walks every continuation page of Blockdaemon's universal
 * `/account/:address/utxo` endpoint and returns the full unspent set in
 * one response, preserving the `meta.nextPageToken: null` API contract
 * (the caller never sees Blockdaemon's own pagination cursor).
 *
 * @param {string} address - account address to query.
 * @param {{pageSize?: number}} filters - `pageSize` sets the per-page
 *   `limit` used while walking (defaults to 100); it does not cap the
 *   returned set.
 * @param {{network: {blockchain: string, environment: string}}} locals
 *   - per-request locals used to build the upstream URL.
 * @returns {Promise<{data: Array<Object>, meta: {nextPageToken: null}}>}
 *   the full unspent-output set for `address`.
 */
const walkUtxo = async (address, filters, locals) => {
  const url = blockdaemonClient.getUniversalUrl(locals, `/account/${address}/utxo`);
  const params = {
    spent: false,
    order: 'desc',
    limit: clampPageSize(filters.pageSize),
  };

  let allData = [];
  let nextPageToken = null;
  let pagesFetched = 0;

  do {
    const requestParams = nextPageToken
      ? { ...params, continuation: nextPageToken }
      : { ...params };

    const { data } = await http.get(
      url,
      blockdaemonClient.getRequestConfig({ params: requestParams, timeout: READ_TIMEOUT })
    );
    allData = allData.concat(mapAddressItems(data.data, address));
    pagesFetched += 1;

    nextPageToken = data.meta?.paging?.next_page_token;

    // The walk is unbounded by design (spending needs the whole set), but an
    // address with an extreme number of outputs would otherwise keep looping
    // until the Lambda is killed, which answers with a gateway error and no
    // envelope. Fail explicitly instead so the caller knows what happened.
    if (nextPageToken && pagesFetched >= MAX_UTXO_PAGES) {
      const error = new Error(
        'This address has too many unspent outputs to enumerate in one request.'
      );
      error.statusCode = 422;
      error.errorCode = 'utxo_set_too_large';
      throw error;
    }
  } while (nextPageToken);

  return {
    data: allData,
    meta: {
      nextPageToken: null,
    },
  };
};

/**
 * Deliberately uncached: the wallet re-reads the UTXO set right after a
 * broadcast to build the next spend, and a 15s-stale set would hand it
 * already-spent outputs.
 */
const getUtxo = walkUtxo;

module.exports = {
  getUtxo,
};
