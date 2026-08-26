'use strict';

/**
 * Transaction-history cache — short-lived in-memory cache shared by
 * the Solana transaction-history endpoints.
 *
 * Two guarantees on top of a plain TTL `Map`:
 *
 *   1. Request coalescing: while one fetch for a given key is
 *      in-flight, every concurrent caller awaits the same Promise via
 *      `pending`. The loader runs at most once per key per window.
 *
 *   2. Clone-on-set / clone-on-get: cached values are deep-cloned both
 *      when stored and when returned, so downstream callers cannot
 *      mutate the cached entry (the resource layer attaches per-
 *      request context to results).
 *
 * Cache keys are computed by `buildCacheKey` over `{ scope, networkId,
 * address, query }` with `query` stably serialized so key ordering is
 * irrelevant.
 */

const CACHE_TTL = 15 * 1000; // 15 seconds

const cache = new Map();
const pending = new Map();

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * Recursively sort object keys (arrays keep order) so two logically
 * identical query objects serialize to the same string regardless of key
 * insertion order. `undefined` values are dropped, matching `JSON.stringify`.
 * @param {*} value
 * @returns {*} value with all nested object keys sorted.
 */
const stableSerialize = (value) => {
  if (Array.isArray(value)) {
    return value.map(stableSerialize);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) {
          result[key] = stableSerialize(value[key]);
        }
        return result;
      }, {});
  }

  return value;
};

/**
 * Returns true when the query represents the first page of a history
 * listing — i.e. no continuation cursor is present. Used by callers to
 * decide whether the result is safe to cache (deeper pages depend on
 * upstream cursors that may rotate).
 *
 * @param {{pageToken?: string, before?: string, continuation?: string}} [query]
 * @returns {boolean}
 */
const isFirstPageQuery = (query = {}) => {
  return !query.pageToken && !query.before && !query.continuation;
};

/**
 * Build a deterministic cache key for a transaction-history request.
 * `query` is normalized via `stableSerialize` so key ordering of the
 * incoming object does not change the resulting key.
 *
 * @param {string} scope - logical bucket (e.g. `'history'`, `'detail'`).
 * @param {string} address - Solana account.
 * @param {object} [query] - request query params.
 * @param {{network?: {id?: string}}} [locals] - per-request locals;
 *   only `network.id` is read.
 * @returns {string} JSON string suitable for `Map` keys.
 */
const buildCacheKey = (scope, address, query = {}, locals = {}) => {
  return JSON.stringify({
    scope,
    networkId: locals?.network?.id,
    address,
    query: stableSerialize(query),
  });
};

/**
 * Read `key` from the TTL map, evicting and returning null if expired.
 * @param {string} key
 * @returns {*} deep-cloned cached value, or null on miss/expiry.
 */
const getCachedValue = (key) => {
  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return clone(entry.value);
};

/**
 * Store `value` under `key`, deep-cloned, with a fresh `CACHE_TTL` expiry.
 * @param {string} key
 * @param {*} value
 * @returns {void}
 */
const setCachedValue = (key, value) => {
  cache.set(key, {
    value: clone(value),
    expiresAt: Date.now() + CACHE_TTL,
  });
};

/**
 * Get the cached value for `key`, or run `loader()` to populate it.
 *
 * Coalesces concurrent calls: while a `loader` is in-flight, parallel
 * callers receive a clone of the same Promise's resolved value rather
 * than re-running the loader. The stored entry is deep-cloned on set,
 * and every read returns a fresh deep clone so callers can mutate the
 * result freely without affecting cached state. Entries expire after
 * `CACHE_TTL` ms.
 *
 * @param {string} key - typically from `buildCacheKey`.
 * @param {() => (any | Promise<any>)} loader - cache-miss loader.
 * @returns {Promise<any>} cloned loader output.
 */
const withCachedTransactionHistory = async (key, loader) => {
  const cached = getCachedValue(key);
  if (cached) {
    return cached;
  }

  if (pending.has(key)) {
    return clone(await pending.get(key));
  }

  const request = Promise.resolve()
    .then(loader)
    .then((value) => {
      setCachedValue(key, value);
      return value;
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, request);

  return clone(await request);
};

/**
 * Drop every cached entry and any in-flight pending loader. Intended
 * for tests; production callers rely on the TTL.
 *
 * @returns {void}
 */
const clearTransactionHistoryCache = () => {
  cache.clear();
  pending.clear();
};

module.exports = {
  CACHE_TTL,
  buildCacheKey,
  clearTransactionHistoryCache,
  isFirstPageQuery,
  withCachedTransactionHistory,
};
