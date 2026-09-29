'use strict';

/**
 * Per provider + environment circuit breaker with state in Redis, so one
 * container's discovery that a provider is down spares every other
 * container the same timeouts.
 *
 * Keys under `breaker:<STAGE>:<env>:<provider>`:
 *   `:failures` — consecutive retryable failures (INCR, expires 2×cooldown)
 *   `:open`     — present while the circuit is open (PX cooldown)
 *   `:probe`    — SET NX PX cooldown: the single half-open probe
 *
 * Only retryable failures (5xx / network / timeout) count; a 4xx is the
 * caller's problem and a 429 is the limiter's. Redis errors fall back to an
 * in-process store; `BREAKER_DISABLED=true` bypasses everything.
 */

const { redis } = require('../../repositories/data-source');
const { MemoryStore } = require('./memory-store');

const memory = new MemoryStore();
let lastWarnAt = 0;

const isDisabled = () => process.env.BREAKER_DISABLED === 'true';

const keyFor = (provider, environment) => `breaker:${process.env.STAGE}:${environment}:${provider}`;

const unavailable = (provider) => {
  const error = new Error(`Upstream provider ${provider} is unavailable, please retry later.`);
  error.statusCode = 503;
  error.errorCode = 'upstream_unavailable';
  return error;
};

/** Run `op` against Redis, falling back to memory (warn once a minute). */
const withStore = async (op) => {
  try {
    return await op(redis);
  } catch (error) {
    if (error.statusCode) throw error;
    if (Date.now() - lastWarnAt >= 60000) {
      lastWarnAt = Date.now();
      console.warn(`[circuit-breaker] Redis unavailable, using in-memory state: ${error.message}`);
    }
    return op(memory);
  }
};

/**
 * @throws 503 `upstream_unavailable` while open, or while another request
 *   holds the half-open probe.
 */
const check = async (provider, environment, breaker) => {
  if (isDisabled() || !breaker) return;
  const key = keyFor(provider, environment);
  await withStore(async (store) => {
    if (await store.get(`${key}:open`)) throw unavailable(provider);
    const failures = Number(await store.get(`${key}:failures`)) || 0;
    if (failures < breaker.failures) return;
    const probe = await store.set(`${key}:probe`, '1', { nx: true, px: breaker.cooldownMs });
    if (probe !== 'OK') throw unavailable(provider);
  });
};

const recordSuccess = async (provider, environment, breaker) => {
  if (isDisabled() || !breaker) return;
  const key = keyFor(provider, environment);
  await withStore((store) => store.del([`${key}:failures`, `${key}:open`, `${key}:probe`]));
};

/** @returns {Promise<boolean>} true when this failure opened the circuit. */
const recordFailure = async (provider, environment, breaker) => {
  if (isDisabled() || !breaker) return false;
  const key = keyFor(provider, environment);
  return withStore(async (store) => {
    const failures = await store.incr(`${key}:failures`);
    await store.pExpire(`${key}:failures`, breaker.cooldownMs * 2);
    if (failures < breaker.failures) return false;
    await store.set(`${key}:open`, '1', { px: breaker.cooldownMs });
    await store.del(`${key}:probe`);
    return true;
  });
};

/** Test helper: forget the in-memory state. */
const resetMemory = () => {
  memory.map.clear();
  lastWarnAt = 0;
};

module.exports = { check, recordSuccess, recordFailure, resetMemory };
