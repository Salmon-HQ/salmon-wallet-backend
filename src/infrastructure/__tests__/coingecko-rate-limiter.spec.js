'use strict';

/**
 * Spec for the CoinGecko rate limiter. Focused on the bits CoinGecko
 * differs from Jupiter on: longer backoff window, retry-after header
 * honored, conservative free-tier defaults.
 */

const { withRetry, RateLimiter, RATE_LIMITS } = require('../rate-limiting/coingecko-rate-limiter');

describe('CoinGecko Rate Limiter', () => {
  describe('withRetry — retry-after header handling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('honors numeric retry-after (seconds) over exponential backoff', async () => {
      const requestFn = jest
        .fn()
        .mockRejectedValueOnce({
          response: { status: 429, headers: { 'retry-after': '3' } },
        })
        .mockResolvedValueOnce({ ok: true });

      const promise = withRetry(requestFn, { maxRetries: 1, initialDelay: 9999 });

      await jest.advanceTimersByTimeAsync(3000);
      const result = await promise;

      expect(result).toEqual({ ok: true });
      expect(requestFn).toHaveBeenCalledTimes(2);
    });

    test('honors HTTP-date retry-after', async () => {
      const futureDate = new Date(Date.now() + 2500).toUTCString();
      const requestFn = jest
        .fn()
        .mockRejectedValueOnce({
          response: { status: 429, headers: { 'retry-after': futureDate } },
        })
        .mockResolvedValueOnce({ ok: true });

      const promise = withRetry(requestFn, { maxRetries: 1, initialDelay: 9999 });
      await jest.advanceTimersByTimeAsync(2600);
      const result = await promise;

      expect(result).toEqual({ ok: true });
    });

    test('falls back to exponential backoff when no retry-after header', async () => {
      const requestFn = jest
        .fn()
        .mockRejectedValueOnce({ response: { status: 429, headers: {} } })
        .mockResolvedValueOnce({ ok: true });

      const promise = withRetry(requestFn, { maxRetries: 1, initialDelay: 1000 });
      await jest.advanceTimersByTimeAsync(1100);
      const result = await promise;

      expect(result).toEqual({ ok: true });
    });

    test('rethrows non-retryable client errors immediately (4xx other than 429)', async () => {
      const requestFn = jest.fn().mockRejectedValue({
        response: { status: 400, headers: {} },
      });
      await expect(withRetry(requestFn, { maxRetries: 3 })).rejects.toMatchObject({
        response: { status: 400 },
      });
      expect(requestFn).toHaveBeenCalledTimes(1);
    });

    test('exhausts max retries on persistent 429 and rethrows the last error', async () => {
      const requestFn = jest.fn().mockRejectedValue({
        response: { status: 429, headers: { 'retry-after': '0' } },
      });

      const promise = withRetry(requestFn, { maxRetries: 2, initialDelay: 100 });
      // Catch immediately so the unhandled rejection doesn't bubble while we
      // advance fake timers.
      const rejection = promise.catch((e) => e);
      await jest.advanceTimersByTimeAsync(2000);
      const err = await rejection;

      expect(err).toMatchObject({ response: { status: 429 } });
      expect(requestFn).toHaveBeenCalledTimes(3);
    });
  });

  describe('RateLimiter token bucket', () => {
    test('refills proportionally to elapsed time', async () => {
      const limiter = new RateLimiter(10, 5);
      // burn the bucket
      for (let i = 0; i < 5; i += 1) limiter.tryConsume();
      expect(limiter.tryConsume()).toBe(false);

      // 200ms × 10 req/s = 2 tokens
      jest.useFakeTimers({ now: Date.now() });
      jest.advanceTimersByTime(200);
      expect(limiter.getTokenCount()).toBeGreaterThanOrEqual(1);
      expect(limiter.tryConsume()).toBe(true);
      jest.useRealTimers();
    });

    test('caps at burst size after long idle', () => {
      const limiter = new RateLimiter(10, 3);
      jest.useFakeTimers({ now: Date.now() });
      jest.advanceTimersByTime(60_000);
      expect(limiter.getTokenCount()).toBe(3);
      jest.useRealTimers();
    });
  });

  describe('RATE_LIMITS configuration', () => {
    test('free tier is meaningfully stricter than paid', () => {
      expect(RATE_LIMITS.FREE_TIER.requestsPerSecond).toBeLessThan(
        RATE_LIMITS.PAID_TIER.requestsPerSecond
      );
      expect(RATE_LIMITS.FREE_TIER.requestsPerMinute).toBe(25);
      expect(RATE_LIMITS.PAID_TIER.requestsPerMinute).toBe(500);
    });
  });
});
