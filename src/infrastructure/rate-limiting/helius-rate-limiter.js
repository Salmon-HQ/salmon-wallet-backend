'use strict';

/**
 * Helius API rate limiter.
 *
 * Helius is the fallback Solana provider behind Triton — calls reach this
 * limiter from `helius-provider.js` (Enhanced API) and `helius-transaction-service.js`
 * (DAS API). The resolver in `src/services/solana/providers/index.js` already
 * caps fallback frequency via `SOLANA_FALLBACK_MAX_RPS`; this limiter adds a
 * second layer that smooths burstiness inside the fallback path so a single
 * page-load doesn't drain the per-second budget in one shot.
 *
 * Helius does return `retry-after` on 429s, so we honor it.
 *
 * Free-tier defaults align with the published 10 req/s ceiling. Set
 * `HELIUS_TIER=paid` to widen the limits when running on a paid plan.
 */

const { RateLimiter } = require('./rate-limiter');
const { createWithRetry } = require('./with-retry');

const RATE_LIMITS = {
  FREE_TIER: {
    requestsPerSecond: 10,
    burstSize: 20,
  },
  PAID_TIER: {
    requestsPerSecond: 50,
    burstSize: 100,
  },
};

const withRetry = createWithRetry({
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 15000,
  operationName: 'Helius API request',
  honorRetryAfter: true,
});

const isPaidTier = process.env.HELIUS_TIER === 'paid';
const limits = isPaidTier ? RATE_LIMITS.PAID_TIER : RATE_LIMITS.FREE_TIER;
const rateLimiter = new RateLimiter(limits.requestsPerSecond, limits.burstSize);

module.exports = {
  withRetry,
  rateLimiter,
  RateLimiter,
  RATE_LIMITS,
};
