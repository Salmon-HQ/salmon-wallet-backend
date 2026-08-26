'use strict';

/**
 * CoinGecko API rate limiter.
 *
 * Free tier is much stricter than Jupiter (~25 req/min sustained), and
 * CoinGecko consistently returns `retry-after` on 429s — we honor it
 * instead of running our own exponential backoff for that single attempt.
 */

const { RateLimiter } = require('./rate-limiter');
const { createWithRetry } = require('./with-retry');

const RATE_LIMITS = {
  FREE_TIER: {
    requestsPerMinute: 25,
    requestsPerSecond: 25 / 60, // ~0.42 req/s sustained
    burstSize: 30,
  },
  PAID_TIER: {
    requestsPerMinute: 500,
    requestsPerSecond: 500 / 60, // ~8.33 req/s sustained
    burstSize: 100,
  },
};

const withRetry = createWithRetry({
  maxRetries: 5,
  initialDelay: 2000,
  maxDelay: 60000,
  operationName: 'CoinGecko API request',
  honorRetryAfter: true,
});

const isFreeTier = !process.env.COINGECKO_API_KEY;
const limits = isFreeTier ? RATE_LIMITS.FREE_TIER : RATE_LIMITS.PAID_TIER;
const rateLimiter = new RateLimiter(limits.requestsPerSecond, limits.burstSize);

console.info(
  `CoinGecko Rate Limiter initialized: ${isFreeTier ? 'FREE' : 'PAID'} tier ` +
    `(${limits.requestsPerMinute} req/min, ${limits.requestsPerSecond.toFixed(2)} req/s, ` +
    `burst: ${limits.burstSize})`
);

module.exports = {
  withRetry,
  rateLimiter,
  RateLimiter,
  RATE_LIMITS,
};
