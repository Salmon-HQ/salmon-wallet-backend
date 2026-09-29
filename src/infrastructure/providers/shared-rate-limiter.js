'use strict';

/**
 * Token bucket shared by every Lambda container through Redis. One Lua
 * script refills by elapsed time (caller-supplied `now`, so a container
 * with a slow clock cannot mint tokens), caps at `burst`, consumes one
 * token or returns the wait in ms — atomically, so two containers can
 * never both take the last slot.
 *
 * Redis errors degrade to the in-process `RateLimiter` (one per provider)
 * with one warning per minute, never a blocked request.
 */

const { redis } = require('../../repositories/data-source');
const { RateLimiter, sleep } = require('../rate-limiting/rate-limiter');
const { remainingMs } = require('./request-deadline');

const MAX_WAIT_MS = 5000;
const KEY_TTL_MS = 60000;
const WARN_EVERY_MS = 60000;

const SCRIPT = `
local key = KEYS[1]
local rps = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil then tokens = burst; ts = now end
if now > ts then
  tokens = math.min(burst, tokens + (now - ts) * rps / 1000)
  ts = now
end
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
else
  wait = math.ceil((1 - tokens) * 1000 / rps)
end
redis.call('HSET', key, 'tokens', tokens, 'ts', ts)
redis.call('PEXPIRE', key, ttl)
return wait
`;

const local = new Map();
let lastWarnAt = 0;

const localLimiter = ({ name, rps, burst }) => {
  if (!local.has(name)) local.set(name, new RateLimiter(rps, burst));
  return local.get(name);
};

const warnFallback = (error) => {
  if (Date.now() - lastWarnAt < WARN_EVERY_MS) return;
  lastWarnAt = Date.now();
  console.warn(
    `[shared-rate-limiter] Redis unavailable, using in-memory limiter: ${error.message}`
  );
};

const rateLimited = () => {
  // Our own throttle, not a fault: 500 would make a deliberate back-pressure
  // decision look like a backend incident.
  const error = new Error('Upstream provider is rate limited, please retry shortly.');
  error.statusCode = 503;
  error.errorCode = 'upstream_rate_limited';
  return error;
};

/** @returns {Promise<number>} wait in ms (0 = token consumed). */
const tryAcquire = async (profile) => {
  const key = `ratelimit:${process.env.STAGE}:${profile.name}`;
  try {
    return Number(
      await redis.eval(SCRIPT, [key], [profile.rps, profile.burst, Date.now(), KEY_TTL_MS])
    );
  } catch (error) {
    warnFallback(error);
    const limiter = localLimiter(profile);
    if (limiter.tryConsume()) return 0;
    return Math.ceil(((1 - limiter.getTokenCount()) * 1000) / profile.rps);
  }
};

/**
 * Take one token for `profile`, sleeping while a slot is due within both
 * `MAX_WAIT_MS` and the request budget.
 *
 * @param {{ name: string, rps: number, burst: number }} profile
 * @param {Object} [locals]
 * @returns {Promise<number>} total ms waited.
 * @throws 503 `upstream_rate_limited` when no slot fits the wait window.
 */
const acquire = async (profile, locals) => {
  let waited = 0;
  for (;;) {
    const wait = await tryAcquire(profile);
    if (wait === 0) return waited;
    if (waited + wait > Math.min(MAX_WAIT_MS, remainingMs(locals))) throw rateLimited();
    await sleep(wait);
    waited += wait;
  }
};

/** Test helper: forget the in-memory fallback buckets. */
const resetLocal = () => {
  local.clear();
  lastWarnAt = 0;
};

module.exports = { acquire, resetLocal, MAX_WAIT_MS, SCRIPT };
