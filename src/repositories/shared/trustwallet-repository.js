'use strict';

/**
 * Trustwallet asset-registry repository — Redis-backed cache (1 day
 * TTL) for the per-blockchain `tokenlist.json`. `trustwallet-service`
 * reads through this so each tx-resource decoration that needs a
 * logo does not hit the public CDN per asset.
 */

const { getCacheKey, getFromCache, storeInCache } = require('../helper');

const ttl = 86400; // 1 day

/** Build the network-scoped cache key for a blockchain's tokenlist. */
const getKey = (blockchain, locals) => getCacheKey(`trustwallet_tokens:${blockchain}`, locals);

/**
 * Cached Trustwallet `tokenlist.json` entries for a blockchain.
 *
 * @param {string} blockchain
 * @param {object} [locals]
 * @returns {Promise<any|null>} cached token list, or `null` on a cache miss.
 */
const getTokens = async (blockchain, locals) => {
  const key = getKey(blockchain, locals);
  return getFromCache(key);
};

/**
 * Cache the Trustwallet `tokenlist.json` entries for a blockchain (1 day TTL).
 *
 * @param {string} blockchain
 * @param {any} tokens
 * @param {object} [locals]
 * @returns {Promise<void>}
 */
const saveTokens = async (blockchain, tokens, locals) => {
  const key = getKey(blockchain, locals);
  await storeInCache(key, tokens, ttl);
};

module.exports = {
  getTokens,
  saveTokens,
};
