'use strict';

/**
 * Shared Redis cache primitives — key building plus JSON get/set with
 * swallow-and-log error handling. Consumed directly by the cache layer
 * (e.g. `price-cache`) and re-exported by `src/repositories/helper.js`
 * for the repository layer.
 */

const { redis } = require('../../repositories/data-source');
const { name } = require('../../../package.json');

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

module.exports = {
  getCacheKey,
  getCacheKeyFor,
  getFromCache,
  storeInCache,
};
