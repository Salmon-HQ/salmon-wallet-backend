'use strict';

/**
 * Jupiter Price service.
 *
 * Thin wrapper over the Jupiter Price v3 endpoint. Adds rate limiting,
 * retry-with-backoff, and Redis-backed caching via `price-cache`.
 *
 * The batch path (`getQuotes`) issues one Jupiter v3 call per request to
 * avoid amplifying portfolio price lookups into N round-trips. The
 * single-mint helper (`price`) delegates through the same service so both
 * surfaces share cache + rate-limiter behavior.
 */

const http = require('axios');
const {
  withRetry,
  rateLimiter,
} = require('../../infrastructure/rate-limiting/jupiter-rate-limiter');
const {
  getQuoteWithCache,
  readCachedQuotes,
  setCachedQuote,
} = require('../../infrastructure/cache/price-cache');

const JUPITER_PRICE_URL = process.env.JUPITER_PRICE_URL;
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;

/**
 * Maximum number of mints a caller should pass to `getQuotes` in one batch.
 * The service trusts that the caller has enforced the cap. Mirrors
 * `MAX_MINTS_PER_QUERY` on the catalog side.
 */
const MAX_MINTS_PER_BATCH = 100;

const requestConfig = () => {
  const config = { timeout: 5000, headers: {} };
  if (JUPITER_API_KEY) {
    config.headers['x-api-key'] = JUPITER_API_KEY;
  }
  return config;
};

const parseQuote = (entry) => {
  if (!entry || entry.usdPrice == null) {
    return null;
  }
  return {
    usdPrice: entry.usdPrice,
    priceChange24h: entry.priceChange24h ?? null,
  };
};

/**
 * Fetch quotes for `mints` from Jupiter Price v3 in a single batched HTTP
 * call. Mints Jupiter does not price are absent from the returned map.
 *
 * @param {string[]} mints
 * @returns {Promise<Map<string, {usdPrice:number, priceChange24h:number|null}>>}
 */
const fetchFromJupiter = async (mints) => {
  if (mints.length === 0) {
    return new Map();
  }

  await rateLimiter.waitAndConsume();

  return withRetry(
    async () => {
      const url = `${JUPITER_PRICE_URL}?ids=${mints.join(',')}`;
      const { data } = await http.get(url, requestConfig());

      const out = new Map();
      mints.forEach((mint) => {
        const quote = parseQuote(data?.[mint]);
        if (quote) {
          out.set(mint, quote);
        }
      });
      return out;
    },
    {
      maxRetries: 3,
      initialDelay: 1000,
      operationName: `Jupiter Price v3 batch (${mints.length} mints)`,
    }
  );
};

/**
 * Resolve quotes for a list of mints, hitting cache first and only calling
 * Jupiter for the residue. Mints with no resolvable quote are absent from
 * the returned map.
 *
 * @param {string[]} mints
 * @param {Object} locals
 * @returns {Promise<Map<string, {usdPrice:number, priceChange24h:number|null}>>}
 */
const getQuotes = async (mints, locals = {}) => {
  if (!Array.isArray(mints) || mints.length === 0) {
    return new Map();
  }

  const unique = [...new Set(mints)];
  const { hits, misses } = await readCachedQuotes(unique, locals);

  if (misses.length === 0) {
    return hits;
  }

  let fresh;
  try {
    fresh = await fetchFromJupiter(misses);
  } catch (error) {
    console.warn(`Jupiter batch fetch failed (${misses.length} mints):`, error.message);
    fresh = new Map();
  }

  await Promise.all(
    [...fresh.entries()].map(([mint, quote]) => setCachedQuote(mint, quote, locals))
  );

  fresh.forEach((quote, mint) => hits.set(mint, quote));
  return hits;
};

/**
 * Single-mint price helper. Returns the USD price as a number, or null when
 * Jupiter has no quote. Delegates through the same cache as the batch path.
 *
 * @param {string} id - Mint address
 * @param {string} _vsToken - Unused (Jupiter v3 always returns USD price)
 * @param {Object} locals
 * @returns {Promise<number|null>}
 */
const price = async (id, _vsToken, locals = {}) => {
  // Guard against missing/empty mint addresses. Jupiter `?ids=` rejects an
  // empty query with 400, so a missing param at the controller level should
  // resolve to `null` (== "no quote") instead of bubbling an AxiosError.
  if (!id || typeof id !== 'string') {
    return null;
  }

  const quote = await getQuoteWithCache(
    id,
    async () => {
      const result = await fetchFromJupiter([id]);
      return result.get(id) || null;
    },
    locals
  );
  return quote ? quote.usdPrice : null;
};

module.exports = { price, getQuotes, MAX_MINTS_PER_BATCH };
