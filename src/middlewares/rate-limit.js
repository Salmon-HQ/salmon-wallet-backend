'use strict';

const { resolveSourceIp } = require('../../packages/network-utils');

const { redis } = require('../repositories/data-source');
const { MemoryStore } = require('../infrastructure/providers/memory-store');

// Counts kept in this process while Redis is unreachable or slow: one
// container then limits what it sees on its own, instead of nothing at all.
const fallback = new MemoryStore();

// Hard cap on how long a single limiter check may hold the request; a slow
// or hung Redis must never add user-visible latency (fail-open).
const REDIS_TIMEOUT_MS = 250;

const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Rate-limit Redis timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Express middleware factory: fixed-window per-IP rate limiter backed by
 * Redis. The window id is part of the key (`rl:{prefix}:{ip}:{window}`), so
 * the EXPIRE is defense-in-depth against key buildup, not the source of
 * truth for the window boundary.
 *
 * Behavior is controlled by `process.env.RATE_LIMIT_MODE` (read per
 * request): 'off' skips entirely, 'log' (default) counts and logs excesses
 * without blocking, 'enforce' responds 429 with a `Retry-After` header.
 * On a Redis error or slowness the count continues in this process's memory,
 * so a flood during a Redis outage is still limited per container; the
 * limiter never breaks a request.
 *
 * @param {object} options
 * @param {number} options.max - Max requests per IP per window.
 * @param {number} options.windowSeconds - Window length in seconds.
 * @param {string} options.prefix - Key namespace (e.g. 'global', 'tx').
 * @returns {(req: object, res: object, next: Function) => Promise<void>}
 *   Express middleware.
 */
module.exports = ({ max, windowSeconds, prefix }) => {
  return async (req, res, next) => {
    const mode = process.env.RATE_LIMIT_MODE || 'log';
    if (mode === 'off') return next();

    const ip = resolveSourceIp(req);
    if (!ip) return next();

    const nowSeconds = Math.floor(Date.now() / 1000);
    const window = Math.floor(nowSeconds / windowSeconds);
    const key = `rl:${prefix}:${ip}:${window}`;

    let count;
    try {
      count = await withTimeout(
        (async () => {
          const value = await redis.incr(key);
          if (value === 1) {
            // ponytail: non-atomic INCR+EXPIRE; window id in the key is the
            // real boundary, so a lost EXPIRE only delays key cleanup.
            await redis.sendCommand(['EXPIRE', key, String(windowSeconds)]);
          }
          return value;
        })(),
        REDIS_TIMEOUT_MS
      );
    } catch (error) {
      console.warn(
        `Rate-limit counting in memory (Redis unavailable) [${prefix}]: ${error.message}`
      );
      count = await fallback.incr(key);
      if (count === 1) await fallback.pExpire(key, windowSeconds * 1000);
    }

    if (count <= max) return next();

    if (mode === 'log') {
      console.warn(`Rate limit exceeded (log mode) [${prefix}] ip=${ip} count=${count} max=${max}`);
      return next();
    }

    const retryAfter = windowSeconds - (nowSeconds % windowSeconds);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'too_many_requests',
      error_description: `Rate limit exceeded, retry in ${retryAfter} seconds`,
    });
  };
};
