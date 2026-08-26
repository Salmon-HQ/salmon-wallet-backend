'use strict';

const { getFromCache, storeInCache, getCacheKeyFor } = require('./cache-helper');

/**
 * Price Cache Service
 *
 * Caches Solana token quotes (Jupiter Price v3) in Redis. Cache entries
 * persist both `usdPrice` and `priceChange24h`; consumers are the swap-order
 * resource (single quote) and the balance price enricher (batch).
 *
 * TTL: 5 minutes (crypto prices change frequently).
 */

const PRICE_CACHE_TTL = 5 * 60;

/**
 * Redis cache key for a mint's price quote, scoped by network via `locals`.
 * @param {string} mintAddress
 * @param {Object} locals - per-request locals (network scoping).
 * @returns {string} Cache key.
 */
const buildKey = (mintAddress, locals) =>
  getCacheKeyFor('jupiter_price', 'mint', mintAddress, locals);

/**
 * Read a cached quote for `mintAddress` or null if absent.
 * @param {string} mintAddress
 * @param {Object} locals
 * @returns {Promise<{usdPrice:number, priceChange24h:number|null}|null>}
 */
const getCachedQuote = async (mintAddress, locals = {}) => {
  try {
    const cached = await getFromCache(buildKey(mintAddress, locals));
    if (!cached || cached.usdPrice == null) {
      return null;
    }
    return {
      usdPrice: cached.usdPrice,
      priceChange24h: cached.priceChange24h ?? null,
    };
  } catch (error) {
    console.warn(`Error reading price cache for ${mintAddress}:`, error.message);
    return null;
  }
};

/**
 * Store a quote in cache.
 * @param {string} mintAddress
 * @param {{usdPrice:number, priceChange24h:number|null}} quote
 * @param {Object} locals
 */
const setCachedQuote = async (mintAddress, quote, locals = {}) => {
  try {
    await storeInCache(
      buildKey(mintAddress, locals),
      {
        usdPrice: quote.usdPrice,
        priceChange24h: quote.priceChange24h ?? null,
        cachedAt: Date.now(),
      },
      PRICE_CACHE_TTL
    );
  } catch (error) {
    console.warn(`Error caching quote for ${mintAddress}:`, error.message);
  }
};

/**
 * Read each mint from cache in parallel.
 * @param {string[]} mintAddresses
 * @param {Object} locals
 * @returns {Promise<{hits: Map<string, {usdPrice:number, priceChange24h:number|null}>, misses: string[]}>}
 */
const readCachedQuotes = async (mintAddresses, locals = {}) => {
  const hits = new Map();
  const misses = [];

  await Promise.all(
    mintAddresses.map(async (mintAddress) => {
      const cached = await getCachedQuote(mintAddress, locals);
      if (cached) {
        hits.set(mintAddress, cached);
      } else {
        misses.push(mintAddress);
      }
    })
  );

  return { hits, misses };
};

/**
 * Get a single quote with cache fallback.
 * @param {string} mintAddress
 * @param {() => Promise<{usdPrice:number, priceChange24h:number|null}|null>} fetchFn - cache-miss loader.
 * @param {Object} locals
 * @returns {Promise<{usdPrice:number, priceChange24h:number|null}|null>}
 */
const getQuoteWithCache = async (mintAddress, fetchFn, locals = {}) => {
  const cached = await getCachedQuote(mintAddress, locals);
  if (cached) {
    return cached;
  }

  const fresh = await fetchFn();
  if (fresh && fresh.usdPrice != null) {
    await setCachedQuote(mintAddress, fresh, locals);
  }

  return fresh;
};

module.exports = {
  setCachedQuote,
  readCachedQuotes,
  getQuoteWithCache,
};
