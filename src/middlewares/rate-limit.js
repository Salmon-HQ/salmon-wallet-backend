'use strict';

const { redis } = require('../repositories/data-source');

// Hard cap on how long a single limiter check may hold the request; a slow
// or hung Redis must never add user-visible latency (fail-open).
const REDIS_TIMEOUT_MS = 250;

/**
 * Resolve the caller IP. Order matters for spoof resistance:
 *   1. API Gateway's `requestContext.identity.sourceIp` (attached to the
 *      Express request by serverless-http) — authoritative.
 *   2. The LAST entry of `X-Forwarded-For` — API Gateway appends the real
 *      client IP at the end; earlier entries are client-controlled.
 *   3. `req.socket.remoteAddress` — direct connections (local dev).
 *
 * @param {object} req - Express request.
 * @returns {string|undefined} The caller IP, or undefined if none is
 *   determinable (in which case the request is not rate limited).
 */
const resolveIp = (req) => {
  const sourceIp = req.requestContext?.identity?.sourceIp;
  if (sourceIp) return sourceIp;

  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length) return entries[entries.length - 1];
  }

  return req.socket?.remoteAddress || undefined;
};

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
 * Any Redis error or slowness fails open — the limiter never breaks a
 * request.
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

    const ip = resolveIp(req);
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
      console.warn(`Rate-limit check skipped (fail-open) [${prefix}]: ${error.message}`);
      return next();
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
