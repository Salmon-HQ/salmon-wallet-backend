'use strict';

/**
 * Jupiter API rate limiter.
 *
 * Token-bucket throttling + retry-with-backoff specialized to Jupiter's
 * tier limits. Retries on 429 + 5xx; doesn't read `retry-after` (Jupiter
 * doesn't surface it consistently across endpoints).
 */

const { RateLimiter } = require('./rate-limiter');
const { createWithRetry } = require('./with-retry');

const RATE_LIMITS = {
  FREE_TIER: {
    requestsPerSecond: 10,
    burstSize: 20,
  },
  PAID_TIER: {
    requestsPerSecond: 100,
    burstSize: 200,
  },
};

const withRetry = createWithRetry({
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  operationName: 'Jupiter API request',
  honorRetryAfter: false,
});

const isFreeTier = !process.env.JUPITER_API_KEY;
const limits = isFreeTier ? RATE_LIMITS.FREE_TIER : RATE_LIMITS.PAID_TIER;
const rateLimiter = new RateLimiter(limits.requestsPerSecond, limits.burstSize);

module.exports = {
  withRetry,
  rateLimiter,
  RateLimiter,
  RATE_LIMITS,
};
