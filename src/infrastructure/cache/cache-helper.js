'use strict';

/**
 * Shared Redis cache primitives — key building plus JSON get/set with
 * swallow-and-log error handling. Consumed directly by the cache layer
 * (e.g. `price-cache`) and re-exported by `src/repositories/helper.js`
 * for the repository layer.
 */

const { redis } = require('../../repositories/data-source');
const { name } = require('../../../package.json');
const { sleep } = require('../rate-limiting/rate-limiter');
const { remainingMs } = require('../providers/request-deadline');
const metrics = require('../providers/metrics');

const LOCK_POLL_MS = 100;

const countCache = (family, hit) =>
  metrics.emit({
    dimensions: { Provider: 'cache', Environment: family, Outcome: hit ? 'hit' : 'miss' },
    metrics: { CacheHit: hit ? 1 : 0, CacheMiss: hit ? 0 : 1 },
  });

/**
 * Build a namespaced Redis key: `<package name>:<STAGE>:<network id>:<suffix>`.
 * Network id is omitted (empty segment) when `locals.network` is not set,
 * so callers outside a per-network request context still get a stable key.
 *
 * @param {string} suffix - caller-supplied key tail (already includes any
 *   entity/id parts).
 * @param {object} [locals] - request locals; only `locals.network.id` is read.
 * @returns {string}
 */
const getCacheKey = (suffix, locals) => {
  return `${name}:${process.env.STAGE}:${locals?.network?.id ?? ''}:${suffix}`;
};

/**
 * Convenience wrapper over {@link getCacheKey} for the common
 * `<entity>_by_<property>:<value>` shape.
 *
 * @param {string} entity
 * @param {string} property
 * @param {string|number} value
 * @param {object} [locals]
 * @returns {string}
 */
const getCacheKeyFor = (entity, property, value, locals) => {
  return getCacheKey(`${entity}_by_${property}:${value}`, locals);
};

/**
 * Read and JSON-parse a cached value by key.
 *
 * @param {string} key
 * @returns {Promise<any|null>} the parsed value, `null` when the key is
 *   missing, or `null` on any Redis/parse error (never throws — errors are
 *   logged via `console.warn`).
 */
const getFromCache = async (key) => {
  try {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : value;
  } catch (e) {
    console.warn(e);
    return null;
  }
};

/**
 * JSON-serialize and store a value under key with a TTL.
 *
 * @param {string} key
 * @param {any} item - value to serialize with `JSON.stringify`.
 * @param {number} ttl - expiry in seconds.
 * @returns {Promise<void>} resolves regardless of outcome — Redis errors
 *   are swallowed and logged via `console.warn`, never thrown.
 */
const storeInCache = async (key, item, ttl) => {
  try {
    const value = JSON.stringify(item);
    await redis.set(key, value, { ex: ttl });
  } catch (e) {
    console.warn(e);
  }
};

/**
 * Read many keys in one MGET.
 * @param {string[]} keys
 * @returns {Promise<Map<string, any>>} key → parsed value; a missing key or
 *   any Redis/parse error maps to `null` (never throws).
 */
const getManyFromCache = async (keys) => {
  const result = new Map(keys.map((key) => [key, null]));
  if (keys.length === 0) return result;
  try {
    const values = await redis.mGet(keys);
    keys.forEach((key, i) => {
      result.set(key, values[i] ? JSON.parse(values[i]) : null);
    });
  } catch (e) {
    console.warn(e);
  }
  return result;
};

/**
 * Store many `[key, value]` pairs with one TTL in one MULTI.
 * @param {Array<[string, any]>} entries
 * @param {number} ttl - expiry in seconds.
 */
const storeManyInCache = async (entries, ttl) => {
  if (entries.length === 0) return;
  try {
    await redis.setMany(
      entries.map(([key, item]) => [key, JSON.stringify(item)]),
      { ex: ttl }
    );
  } catch (e) {
    console.warn(e);
  }
};

const tryLock = async (lockKey, lockMs) => {
  try {
    return (await redis.set(lockKey, '1', { nx: true, px: lockMs })) === 'OK';
  } catch (e) {
    console.warn(e);
    return true; // no Redis → every process is its own single flight
  }
};

/**
 * Single-flight rebuild with stale-while-revalidate: a fresh value is
 * returned as-is; otherwise one caller (the `SET NX` lock holder) runs
 * `rebuild` and writes `key` (ttl) plus `key:stale` (staleTtl), while the
 * others serve the stale copy, or poll for the fresh one when none exists
 * (bounded by `lockMs` and the request budget). A failing rebuild falls back
 * to the stale copy when there is one — this is what keeps a catalog served
 * while its provider's circuit is open.
 *
 * @param {string} key
 * @param {{ ttl: number, staleTtl: number, lockMs: number, rebuild: () => Promise<any>, locals?: Object }} options
 */
const withSingleFlight = async (key, { ttl, staleTtl, lockMs, rebuild, locals }) => {
  const family = key.split(':').pop();
  const fresh = await getFromCache(key);
  countCache(family, fresh !== null);
  if (fresh !== null) return fresh;

  const staleKey = `${key}:stale`;
  const lockKey = `${key}:lock`;
  if (await tryLock(lockKey, lockMs)) {
    try {
      const value = await rebuild();
      await storeInCache(key, value, ttl);
      await storeInCache(staleKey, value, staleTtl);
      return value;
    } catch (error) {
      const stale = await getFromCache(staleKey);
      if (stale === null) throw error;
      console.warn(`[cache] serving stale ${family} after rebuild failed: ${error.message}`);
      return stale;
    } finally {
      await redis.del(lockKey).catch(console.warn);
    }
  }

  const stale = await getFromCache(staleKey);
  if (stale !== null) return stale;

  const until = Date.now() + Math.min(lockMs, remainingMs(locals));
  while (Date.now() < until) {
    await sleep(LOCK_POLL_MS);
    const value = await getFromCache(key);
    if (value !== null) return value;
  }
  return rebuild(); // lock holder died or ran out of time; the budget bounds us too
};

module.exports = {
  getCacheKey,
  getCacheKeyFor,
  getFromCache,
  storeInCache,
  getManyFromCache,
  storeManyInCache,
  withSingleFlight,
};
