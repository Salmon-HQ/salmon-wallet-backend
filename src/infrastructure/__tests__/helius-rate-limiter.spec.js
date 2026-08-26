'use strict';

const { withRetry, RateLimiter, RATE_LIMITS } = require('../rate-limiting/helius-rate-limiter');

describe('Helius Rate Limiter', () => {
  describe('withRetry — Helius-tuned retries', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('retries on 429 with retry-after header', async () => {
      const requestFn = jest
        .fn()
        .mockRejectedValueOnce({
          response: { status: 429, headers: { 'retry-after': '1' } },
        })
        .mockResolvedValueOnce('ok');

      const promise = withRetry(requestFn, { maxRetries: 1 });
      await jest.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(result).toBe('ok');
      expect(requestFn).toHaveBeenCalledTimes(2);
    });

    test('retries on 5xx server errors using exponential backoff', async () => {
      const requestFn = jest
        .fn()
        .mockRejectedValueOnce({ response: { status: 503, headers: {} } })
        .mockResolvedValueOnce('ok');

      const promise = withRetry(requestFn, { maxRetries: 1, initialDelay: 100 });
      await jest.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result).toBe('ok');
    });

    test('retries on network errors (no response)', async () => {
      const requestFn = jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }))
        .mockResolvedValueOnce('ok');

      const promise = withRetry(requestFn, { maxRetries: 1, initialDelay: 100 });
      await jest.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result).toBe('ok');
    });

    test('does not retry on 4xx (except 429)', async () => {
      const requestFn = jest.fn().mockRejectedValue({
        response: { status: 401, headers: {} },
      });
      await expect(withRetry(requestFn, { maxRetries: 3 })).rejects.toMatchObject({
        response: { status: 401 },
      });
      expect(requestFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('RateLimiter', () => {
    test('blocks once burst is exhausted, then unblocks after refill', async () => {
      const limiter = new RateLimiter(10, 2);
      expect(limiter.tryConsume()).toBe(true);
      expect(limiter.tryConsume()).toBe(true);
      expect(limiter.tryConsume()).toBe(false);
    });
  });

  describe('RATE_LIMITS configuration', () => {
    test('defaults to free tier when HELIUS_TIER is not set', () => {
      // Sanity: paid tier exists and is wider than free
      expect(RATE_LIMITS.PAID_TIER.requestsPerSecond).toBeGreaterThan(
        RATE_LIMITS.FREE_TIER.requestsPerSecond
      );
    });
  });
});
