'use strict';

const { getCacheKey, getFromCache, storeInCache } = require('../helper');

const verifiedTtl = 300; // 5 minutos

/**
 * Cached Solana verified-only fungible-token catalog (5min TTL).
 *
 * @param {object} [locals]
 * @returns {Promise<any|null>} cached token list, or `null` on a cache miss.
 */
const getVerifiedTokens = async (locals) => {
  const key = getCacheKey('solana_ft_verified', locals);
  return getFromCache(key);
};

/**
 * Cache the Solana verified-only fungible-token catalog.
 *
 * @param {any} tokens
 * @param {object} [locals]
 * @returns {Promise<void>}
 */
const saveVerifiedTokens = async (tokens, locals) => {
  const key = getCacheKey('solana_ft_verified', locals);
  return storeInCache(key, tokens, verifiedTtl);
};

module.exports = { getVerifiedTokens, saveVerifiedTokens };
