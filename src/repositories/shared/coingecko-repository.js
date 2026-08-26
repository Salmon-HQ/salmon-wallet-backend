'use strict';

/**
 * CoinGecko repository — Redis-backed cache with two-tier TTL
 * (short-term + long-term) for token prices, market charts, coin
 * info, and exchange rates. The long-term tier is the fallback used
 * by `coingecko-service` when CoinGecko 429s or fails.
 */

const { getCacheKey, getFromCache, storeInCache } = require('../helper');

const shortTermTtl = 300; // 5 minutes
const longTermTtl = 21600; // 6 hours
const chartLongTermTtl = 86400; // 24 hours for chart data
const exchangeRatesShortTermTtl = 900; // 15 minutes

/**
 * Cached full token list for a platform (no per-network key — shared
 * across networks by design, unlike the `locals`-scoped getters below).
 *
 * @param {string} platform - CoinGecko asset-platform id (e.g. `'solana'`).
 * @returns {Promise<any|null>} cached list, or `null` on a cache miss.
 */
const getTokensList = async (platform) => {
  return getFromCache(`${platform}:tokens_list`);
};

/**
 * Cached token prices for a platform.
 *
 * @param {string} platform
 * @returns {Promise<any|null>} cached prices, or `null` on a cache miss.
 */
const getTokensPrices = async (platform) => {
  return getFromCache(`${platform}:tokens_prices`);
};

/**
 * Cache the full token list for a platform (long-term TTL, 6h).
 *
 * @param {any} tokens
 * @param {string} platform
 * @returns {Promise<void>}
 */
const saveTokensList = async (tokens, platform) => {
  await storeInCache(`${platform}:tokens_list`, tokens, longTermTtl);
};

/**
 * Cache token prices for a platform (long-term TTL, 6h).
 *
 * @param {any} prices
 * @param {string} platform
 * @returns {Promise<void>}
 */
const saveTokensPrices = async (prices, platform) => {
  await storeInCache(`${platform}:tokens_prices`, prices, longTermTtl);
};

/**
 * Build the network-scoped cache key for a chart entry.
 *
 * @param {string} type - `'short_term_chart'` | `'long_term_chart'`.
 * @param {{coinId: string, days: string|number, currency: string}} params
 * @param {object} [locals]
 * @returns {string}
 */
const getChartKey = (type, { coinId, days, currency }, locals) => {
  return getCacheKey(`${type}:${coinId}:${currency}:${days}`, locals);
};

/**
 * Short-term cached chart data (fresh tier; see {@link saveChart} for TTL).
 *
 * @param {{coinId: string, days: string|number, currency: string}} params
 * @param {object} [locals]
 * @returns {Promise<any|null>} cached chart data, or `null` on a cache miss.
 */
const getShortTermChart = async (params, locals) => {
  const key = getChartKey('short_term_chart', params, locals);
  return getFromCache(key);
};

/**
 * Long-term cached chart data — the fallback `coingecko-service` reads
 * when CoinGecko 429s or fails.
 *
 * @param {{coinId: string, days: string|number, currency: string}} params
 * @param {object} [locals]
 * @returns {Promise<any|null>} cached chart data, or `null` on a cache miss.
 */
const getLongTermChart = async (params, locals) => {
  const key = getChartKey('long_term_chart', params, locals);
  return getFromCache(key);
};

/**
 * Cache chart data under both the short-term and long-term keys. TTL
 * scales with history length: `days === 'max' | 'ytd' | > 30` gets the
 * "long history" tiers (1h short-term / 24h long-term); everything else
 * gets 5min short-term / 6h long-term.
 *
 * @param {{coinId: string, days: string|number, currency: string}} params
 * @param {any} chartData
 * @param {object} [locals]
 * @returns {Promise<void>}
 */
const saveChart = async (params, chartData, locals) => {
  // Use longer TTL for historical data (max, ytd, or > 30 days)
  const isLongHistory = params.days === 'max' || params.days === 'ytd' || params.days > 30;
  const shortTtl = isLongHistory ? 3600 : shortTermTtl; // 1 hour for long history, 5 min for short
  const longTtl = isLongHistory ? chartLongTermTtl : longTermTtl; // 24h for long history, 6h for short

  const shortTermKey = getChartKey('short_term_chart', params, locals);
  await storeInCache(shortTermKey, chartData, shortTtl);

  const longTermKey = getChartKey('long_term_chart', params, locals);
  await storeInCache(longTermKey, chartData, longTtl);
};

/**
 * Build the network-scoped cache key for a coin-info entry.
 *
 * @param {string} type - `'short_term_coin_info'` | `'long_term_coin_info'`.
 * @param {{coinId: string, currency: string}} params
 * @param {object} [locals]
 * @returns {string}
 */
const getCoinInfoKey = (type, { coinId, currency }, locals) => {
  return getCacheKey(`${type}:${coinId}:${currency}`, locals);
};

/**
 * Short-term cached coin info (fresh tier, 10min — see {@link saveCoinInfo}).
 *
 * @param {{coinId: string, currency: string}} params
 * @param {object} [locals]
 * @returns {Promise<any|null>} cached coin info, or `null` on a cache miss.
 */
const getShortTermCoinInfo = async (params, locals) => {
  const key = getCoinInfoKey('short_term_coin_info', params, locals);
  return getFromCache(key);
};

/**
 * Long-term cached coin info (fallback tier, 24h — see {@link saveCoinInfo}).
 *
 * @param {{coinId: string, currency: string}} params
 * @param {object} [locals]
 * @returns {Promise<any|null>} cached coin info, or `null` on a cache miss.
 */
const getLongTermCoinInfo = async (params, locals) => {
  const key = getCoinInfoKey('long_term_coin_info', params, locals);
  return getFromCache(key);
};

/**
 * Cache coin info under both the short-term (10min) and long-term (24h)
 * keys.
 *
 * @param {{coinId: string, currency: string}} params
 * @param {any} coinInfo
 * @param {object} [locals]
 * @returns {Promise<void>}
 */
const saveCoinInfo = async (params, coinInfo, locals) => {
  // Coin info changes less frequently, use longer TTL
  const shortTermKey = getCoinInfoKey('short_term_coin_info', params, locals);
  await storeInCache(shortTermKey, coinInfo, 600); // 10 minutes

  const longTermKey = getCoinInfoKey('long_term_coin_info', params, locals);
  await storeInCache(longTermKey, coinInfo, chartLongTermTtl); // 24 hours
};

/**
 * Short-term cached exchange rates (fresh tier, 15min).
 *
 * @param {object} [locals]
 * @returns {Promise<any|null>} cached rates, or `null` on a cache miss.
 */
const getShortTermExchangeRates = async (locals) => {
  return getFromCache(getCacheKey('short_term_exchange_rates', locals));
};

/**
 * Long-term cached exchange rates (fallback tier, 6h).
 *
 * @param {object} [locals]
 * @returns {Promise<any|null>} cached rates, or `null` on a cache miss.
 */
const getLongTermExchangeRates = async (locals) => {
  return getFromCache(getCacheKey('long_term_exchange_rates', locals));
};

/**
 * Cache exchange rates under both the short-term (15min) and long-term
 * (6h) keys.
 *
 * @param {any} rates
 * @param {object} [locals]
 * @returns {Promise<void>}
 */
const saveExchangeRates = async (rates, locals) => {
  await storeInCache(
    getCacheKey('short_term_exchange_rates', locals),
    rates,
    exchangeRatesShortTermTtl
  );
  await storeInCache(getCacheKey('long_term_exchange_rates', locals), rates, longTermTtl);
};

module.exports = {
  saveTokensList,
  saveTokensPrices,
  getTokensList,
  getTokensPrices,
  getShortTermChart,
  getLongTermChart,
  saveChart,
  getShortTermCoinInfo,
  getLongTermCoinInfo,
  saveCoinInfo,
  getShortTermExchangeRates,
  getLongTermExchangeRates,
  saveExchangeRates,
};
