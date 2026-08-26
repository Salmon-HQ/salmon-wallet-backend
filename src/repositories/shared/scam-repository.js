'use strict';

/**
 * Scam-list repository — Redis-backed cache (1 day TTL) for the
 * per-blockchain Phantom Labs blocklist. `scam-service` reads through
 * this to spare upstream GitHub on every wallet asset render.
 */

const { getCacheKey, getFromCache, storeInCache } = require('../helper');

const ttl = 86400; // 1 day

/** Build the network-scoped cache key for a chain's blocklist. */
const getKey = (chain, locals) => getCacheKey(`scam_urls:${chain}`, locals);

/**
 * Cached Phantom Labs blocklist URLs for a chain.
 *
 * @param {string} chain
 * @param {object} [locals]
 * @returns {Promise<any|null>} cached URLs, or `null` on a cache miss.
 */
const getUrls = async (chain, locals) => {
  const key = getKey(chain, locals);
  return getFromCache(key);
};

/**
 * Cache the Phantom Labs blocklist URLs for a chain (1 day TTL).
 *
 * @param {string} chain
 * @param {any} urls
 * @param {object} [locals]
 * @returns {Promise<void>}
 */
const saveUrls = async (chain, urls, locals) => {
  const key = getKey(chain, locals);
  await storeInCache(key, urls, ttl);
};

module.exports = {
  getUrls,
  saveUrls,
};
