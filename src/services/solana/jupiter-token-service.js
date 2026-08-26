'use strict';

/**
 * Jupiter Tokens v2 service.
 *
 * Wraps the Jupiter Tokens v2 search and tag endpoints with rate limiting
 * and retry-with-backoff. Used to resolve token metadata for swap
 * enrichment, the verified-token list, and free-text token search.
 */

const http = require('axios');
const {
  withRetry,
  rateLimiter,
} = require('../../infrastructure/rate-limiting/jupiter-rate-limiter');

const JUPITER_TOKENS_V2_URL = 'https://api.jup.ag/tokens/v2/search';
const JUPITER_TOKENS_V2_TAG_URL = 'https://api.jup.ag/tokens/v2/tag';
/** Maximum number of mint addresses Jupiter accepts per single search query. */
const MAX_MINTS_PER_QUERY = 100;
const REQUEST_TIMEOUT = 10000;

// Lazy-read the API key on every request so deploys that inject the env
// after module load (Lambda layers, delayed init) still pick it up. Mirrors
// the pattern applied to HELIUS_API_KEY in helius-client.
const buildHeaders = () => {
  const apiKey = process.env.JUPITER_API_KEY;
  return apiKey ? { 'x-api-key': apiKey } : {};
};

/**
 * Shared GET helper for the three Jupiter Tokens v2 endpoints below: waits
 * on the rate limiter, retries with backoff via `withRetry`, and normalizes
 * a non-array response body to `[]` (logging `warningMessage`) instead of
 * throwing.
 * @param {{url: string, operationName: string, warningMessage: string}} params
 * @returns {Promise<Object[]>}
 */
const fetchTokenArray = async ({ url, operationName, warningMessage }) => {
  await rateLimiter.waitAndConsume();

  return withRetry(
    async () => {
      const { data } = await http.get(url, {
        timeout: REQUEST_TIMEOUT,
        headers: buildHeaders(),
      });

      if (!Array.isArray(data)) {
        console.warn(warningMessage);
        return [];
      }

      return data;
    },
    {
      maxRetries: 3,
      initialDelay: 1000,
      operationName,
    }
  );
};

/**
 * Get tokens by mint addresses from Jupiter Tokens V2 API
 *
 * @param {string[]} mintAddresses - Array of token mint addresses
 * @param {Object} locals - Request locals
 * @returns {Promise<Object[]>} Array of token data
 */
const getTokensByMints = async (mintAddresses, _locals = {}) => {
  if (!mintAddresses || mintAddresses.length === 0) {
    return [];
  }

  const limitedMints = mintAddresses.slice(0, MAX_MINTS_PER_QUERY);
  const query = limitedMints.join(',');

  return fetchTokenArray({
    url: `${JUPITER_TOKENS_V2_URL}?query=${encodeURIComponent(query)}`,
    operationName: `Jupiter Tokens V2 (${limitedMints.length} mints)`,
    warningMessage: 'Jupiter Tokens V2 API returned unexpected format',
  });
};

/**
 * Get verified tokens from Jupiter Tokens V2 API
 *
 * @param {Object} locals - Request locals
 * @returns {Promise<Object[]>} Array of verified token data
 */
const getVerifiedTokens = async (_locals = {}) => {
  return fetchTokenArray({
    url: `${JUPITER_TOKENS_V2_TAG_URL}?query=verified`,
    operationName: 'Jupiter Tokens V2 Verified',
    warningMessage: 'Jupiter Tokens V2 Tag API returned unexpected format',
  });
};

/**
 * Search tokens by query from Jupiter Tokens V2 API
 *
 * @param {string} query - Search query (name or symbol)
 * @param {Object} locals - Request locals
 * @returns {Promise<Object[]>} Array of token search results
 */
const searchTokensByQuery = async (query, _locals = {}) => {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return [];
  }

  return fetchTokenArray({
    url: `${JUPITER_TOKENS_V2_URL}?query=${encodeURIComponent(query.trim())}`,
    operationName: `Jupiter Tokens V2 Search (${query})`,
    warningMessage: 'Jupiter Tokens V2 Search API returned unexpected format',
  });
};

module.exports = { getTokensByMints, getVerifiedTokens, searchTokensByQuery, MAX_MINTS_PER_QUERY };
