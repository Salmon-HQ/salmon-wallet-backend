'use strict';

/**
 * Sanctions repository — Redis-backed (spec 018, US3).
 *
 *   `sanctions:addresses`   set of every `Digital Currency Address - *`
 *                           value from the US Treasury SDN list, any chain,
 *                           verbatim. Replaced atomically: the job fills
 *                           `sanctions:addresses:next` and RENAMEs it over.
 *   `sanctions:fetched_at`  ISO timestamp of the last successful refresh.
 *   `sanctions:trm:<addr>`  cached TRM verdict `{ isSanctioned, checkedAt }`,
 *                           24 h.
 *
 * Set membership and the replace throw on a Redis error so the service can
 * tell "not listed" from "could not check"; the TRM cache uses the
 * swallow-and-log helpers like every other cache.
 */

const { redis } = require('../data-source');
const { getCacheKey, getFromCache, storeInCache } = require('../helper');

const TRM_TTL = 86400; // 24 hours
const SADD_CHUNK = 500;

const key = (suffix) => getCacheKey(`sanctions:${suffix}`);

/** @returns {Promise<{ isSanctioned: boolean, checkedAt: string }|null>} */
const getTrmVerdict = (address) => getFromCache(key(`trm:${address}`));

const saveTrmVerdict = (address, isSanctioned) =>
  storeInCache(
    key(`trm:${address}`),
    { isSanctioned, checkedAt: new Date().toISOString() },
    TRM_TTL
  );

/** @returns {Promise<boolean>} whether a local copy exists at all. */
const hasLocalList = async () => (await redis.exists([key('addresses')])) === 1;

/** @returns {Promise<boolean>} exact, case-sensitive membership. Throws on Redis error. */
const isListedLocally = async (address) =>
  (await redis.sendCommand(['SISMEMBER', key('addresses'), address])) === 1;

/** @returns {Promise<number>} how many addresses the live set holds (0 when absent). */
const getLocalListSize = async () =>
  Number(await redis.sendCommand(['SCARD', key('addresses')])) || 0;

/** @returns {Promise<string|null>} ISO timestamp of the last refresh. */
const getFetchedAt = () => redis.get(key('fetched_at'));

/**
 * Replace the local list in one step: fill `:next`, RENAME over the live key.
 * @param {string[]} addresses - non-empty.
 */
const replaceLocalList = async (addresses) => {
  const next = key('addresses:next');
  await redis.del([next]);
  for (let i = 0; i < addresses.length; i += SADD_CHUNK) {
    await redis.sendCommand(['SADD', next, ...addresses.slice(i, i + SADD_CHUNK)]);
  }
  await redis.sendCommand(['RENAME', next, key('addresses')]);
  await redis.set(key('fetched_at'), new Date().toISOString());
};

module.exports = {
  getTrmVerdict,
  saveTrmVerdict,
  hasLocalList,
  isListedLocally,
  getFetchedAt,
  getLocalListSize,
  replaceLocalList,
};
