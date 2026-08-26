'use strict';

/**
 * In-memory token-bucket rate limiter shared across the per-provider
 * limiters (Jupiter, CoinGecko, Helius). For multi-instance deployments,
 * consider swapping this for a Redis-backed implementation.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Token-bucket limiter: `burstSize` tokens available up front, refilled
 * continuously at `requestsPerSecond`. One token is consumed per request.
 */
class RateLimiter {
  /**
   * @param {number} requestsPerSecond - sustained refill rate.
   * @param {number} burstSize - bucket capacity (max tokens, initial tokens).
   */
  constructor(requestsPerSecond, burstSize) {
    this.capacity = burstSize;
    this.tokens = burstSize;
    this.refillRate = requestsPerSecond;
    this.lastRefill = Date.now();
  }

  /**
   * Top up `tokens` based on elapsed time since the last refill, capped at
   * `capacity`. Called before every read/consume so the bucket state stays
   * current without a background timer.
   * @returns {void}
   */
  refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Refill, then consume one token if available.
   * @returns {boolean} true if a token was consumed, false if the bucket is empty.
   */
  tryConsume() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Block until a token is available or `maxWaitTime` ms elapse.
   * @param {number} [maxWaitTime=5000]
   * @throws {Error} when the wait window expires before a token frees up
   */
  async waitAndConsume(maxWaitTime = 5000) {
    const startTime = Date.now();
    while (!this.tryConsume()) {
      if (Date.now() - startTime >= maxWaitTime) {
        // Our own throttle, not a fault: answering 500 server_error made a
        // deliberate back-pressure decision look like a backend incident and
        // told the caller nothing about retrying.
        const error = new Error('Upstream provider is rate limited, please retry shortly.');
        error.statusCode = 503;
        error.errorCode = 'upstream_rate_limited';
        throw error;
      }
      await sleep(100);
    }
  }

  /** Current token count (useful for debugging). */
  getTokenCount() {
    this.refill();
    return this.tokens;
  }
}

module.exports = { RateLimiter, sleep };
