'use strict';

/**
 * 0x API rate limiter.
 *
 * The free tier allows ~5 requests per second across every 0x endpoint in a
 * fixed 1 s window (docs.0x.org/docs/developer-resources/rate-limits). One
 * bucket for the whole process keeps a burst of swap builds from tripping
 * it. Retries on 429 + 5xx like the other provider limiters.
 */

const { RateLimiter } = require('./rate-limiter');
const { createWithRetry } = require('./with-retry');

const REQUESTS_PER_SECOND = Number(process.env.ZEROEX_MAX_RPS) || 5;

const withRetry = createWithRetry({
  maxRetries: 2,
  initialDelay: 500,
  maxDelay: 4000,
  operationName: '0x API request',
  honorRetryAfter: true,
});

const rateLimiter = new RateLimiter(REQUESTS_PER_SECOND, REQUESTS_PER_SECOND);

module.exports = { withRetry, rateLimiter };
