'use strict';

/**
 * Default balance provider — Blockdaemon Universal API.
 *
 * Works for any chain Blockdaemon supports under
 * `/universal/v1/<blockchain>/<environment>/account/<address>` (currently
 * Bitcoin and Solana). Items are returned as-is from upstream and
 * annotated with the requested owner + blockchain.
 *
 * Chain slices can override this provider with a richer one (e.g.
 * Alchemy for Ethereum) by registering in
 * `./index.js#PROVIDERS_BY_CHAIN`.
 */

const http = require('axios');
const blockdaemonClient = require('../../../infrastructure/blockdaemon-client');

/**
 * Decorates each upstream balance item with the requesting `owner`
 * address and `blockchain`, per the `BalanceProvider` contract.
 *
 * @param {Array<Object>} items - raw items from Blockdaemon.
 * @param {string} address - requested owner address.
 * @param {string} blockchain - value of `locals.network.blockchain`.
 * @returns {Array<Object>} items with `owner` + `blockchain` added.
 */
const mapOwnedItems = (items, address, blockchain) =>
  items.map((item) => ({ ...item, owner: address, blockchain }));

/**
 * `BalanceProvider#getBalance` implementation backed by Blockdaemon's
 * Universal API. `_tokens` is unused — Blockdaemon returns every asset
 * for the account in one call.
 *
 * @param {string} address - account address to query.
 * @param {any} _tokens - unused; kept for `BalanceProvider` signature parity.
 * @param {{network: {blockchain: string, environment: string}}} locals
 *   - per-request locals used to build the upstream URL.
 * @returns {Promise<Array<Object>>} balance items decorated with
 *   `owner` + `blockchain`.
 */
const getBalance = async (address, _tokens, locals) => {
  const { blockchain } = locals.network;
  const url = blockdaemonClient.getUniversalUrl(locals, `/account/${address}`);

  const { data } = await http.get(
    url,
    blockdaemonClient.getRequestConfig({ params: {}, timeout: 6000 })
  );

  return mapOwnedItems(data, address, blockchain);
};

module.exports = { getBalance };
