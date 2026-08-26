'use strict';

/**
 * Bridge repository — Redis-backed cache for the StealthEX bridge
 * surface. Persists `featured` (curated subset) and `available`
 * (full filtered upstream list) under short TTLs so the bridge service
 * can absorb upstream rate-limits without amplifying them downstream.
 */

const { getFromCache, storeInCache } = require('../helper');
const { name } = require('../../../package.json');

// Cache TTL in seconds
const PAIRS_TTL = 600; // 10 minutes - pairs/rates can change more frequently

/**
 * Build the `<package name>:<STAGE>:bridge:<suffix>` cache key for this
 * repository's entries.
 *
 * @param {string} suffix
 * @returns {string}
 */
const getCacheKey = (suffix) => {
  return `${name}:${process.env.STAGE}:bridge:${suffix}`;
};

// Featured tokens cache (per symbol)
/**
 * Cached curated ("featured") bridge token list for a symbol.
 *
 * @param {string} symbol
 * @returns {Promise<any|null>} cached value, or `null` on a cache miss.
 */
const getFeatured = async (symbol) => {
  const key = getCacheKey(`featured:${symbol}`);
  return getFromCache(key);
};

/**
 * Cache the curated ("featured") bridge token list for a symbol.
 *
 * @param {string} symbol
 * @param {any} data
 * @returns {Promise<void>}
 */
const saveFeatured = async (symbol, data) => {
  const key = getCacheKey(`featured:${symbol}`);
  return storeInCache(key, data, PAIRS_TTL);
};

// Available tokens cache (per symbol)
/**
 * Cached full filtered upstream bridge token list for a symbol.
 *
 * @param {string} symbol
 * @returns {Promise<any|null>} cached value, or `null` on a cache miss.
 */
const getAvailable = async (symbol) => {
  const key = getCacheKey(`available:${symbol}`);
  return getFromCache(key);
};

/**
 * Cache the full filtered upstream bridge token list for a symbol.
 *
 * @param {string} symbol
 * @param {any} data
 * @returns {Promise<void>}
 */
const saveAvailable = async (symbol, data) => {
  const key = getCacheKey(`available:${symbol}`);
  return storeInCache(key, data, PAIRS_TTL);
};

// The currency catalogue changes far more slowly than rates — new listings,
// not price movement — so it gets its own, longer TTL.
const CURRENCIES_TTL = 3600; // 1 hour

/**
 * Cached StealthEX currency catalogue (the full `(symbol, network,
 * legacy_symbol)` list used to translate between the public symbol vocabulary
 * and v4's pair addressing).
 *
 * @returns {Promise<Array<Object>|null>}
 */
const getCurrencies = async () => {
  return getFromCache(getCacheKey('currencies'));
};

/**
 * @param {Array<Object>} currencies
 * @returns {Promise<void>}
 */
const saveCurrencies = async (currencies) => {
  return storeInCache(getCacheKey('currencies'), currencies, CURRENCIES_TTL);
};

module.exports = {
  getFeatured,
  saveFeatured,
  getAvailable,
  saveAvailable,
  getCurrencies,
  saveCurrencies,
};
