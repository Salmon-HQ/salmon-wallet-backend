'use strict';

const { withRetry, RateLimiter, RATE_LIMITS } = require('../rate-limiting/jupiter-rate-limiter');

describe('Jupiter Rate Limiter', () => {
  describe('withRetry()', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('should return result on first successful attempt', async () => {
      const mockFn = jest.fn().mockResolvedValue({ data: 'success' });

      const result = await withRetry(mockFn);

      expect(result).toEqual({ data: 'success' });
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should retry on 429 rate limit error', async () => {
      const mockError = new Error('Rate limit exceeded');
      mockError.response = { status: 429, data: { error: 'Too many requests' } };

      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(mockError)
        .mockResolvedValue({ data: 'success' });

      const result = await withRetry(mockFn, {
        maxRetries: 1,
        initialDelay: 10,
        operationName: 'Test API',
      });

      expect(result).toEqual({ data: 'success' });
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    test('should retry on 500 server error', async () => {
      const mockError = new Error('Internal server error');
      mockError.response = { status: 500, data: { error: 'Server error' } };

      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(mockError)
        .mockResolvedValue({ data: 'success' });

      const result = await withRetry(mockFn, {
        maxRetries: 1,
        initialDelay: 10,
      });

      expect(result).toEqual({ data: 'success' });
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    test('should retry on network errors', async () => {
      const mockError = new Error('Network error');
      // No response = network error

      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(mockError)
        .mockResolvedValue({ data: 'success' });

      const result = await withRetry(mockFn, {
        maxRetries: 1,
        initialDelay: 10,
      });

      expect(result).toEqual({ data: 'success' });
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    test('should NOT retry on 400 client error', async () => {
      const mockError = new Error('Bad request');
      mockError.response = { status: 400, data: { error: 'Invalid params' } };

      const mockFn = jest.fn().mockRejectedValue(mockError);

      await expect(
        withRetry(mockFn, {
          maxRetries: 3,
          initialDelay: 10,
        })
      ).rejects.toThrow('Bad request');

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should NOT retry on 404 not found error', async () => {
      const mockError = new Error('Not found');
      mockError.response = { status: 404, data: { error: 'Not found' } };

      const mockFn = jest.fn().mockRejectedValue(mockError);

      await expect(
        withRetry(mockFn, {
          maxRetries: 3,
          initialDelay: 10,
        })
      ).rejects.toThrow('Not found');

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should exhaust retries and throw last error', async () => {
      const mockError = new Error('Persistent error');
      mockError.response = { status: 500 };

      const mockFn = jest.fn().mockRejectedValue(mockError);

      await expect(
        withRetry(mockFn, {
          maxRetries: 2,
          initialDelay: 10,
        })
      ).rejects.toThrow('Persistent error');

      expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    test('should implement exponential backoff', async () => {
      const delays = [];
      const originalSetTimeout = global.setTimeout;

      // Mock setTimeout to capture delays
      global.setTimeout = jest.fn((fn, delay) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0); // Execute immediately for testing
      });

      const mockError = new Error('Error');
      mockError.response = { status: 500 };

      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(mockError)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValue({ data: 'success' });

      await withRetry(mockFn, {
        maxRetries: 2,
        initialDelay: 100,
        backoffMultiplier: 2,
      });

      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;

      expect(delays).toEqual([100, 200]); // 100ms, then 200ms (2x)
    });

    test('should respect max delay limit', async () => {
      const delays = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = jest.fn((fn, delay) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0);
      });

      const mockError = new Error('Error');
      mockError.response = { status: 500 };

      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(mockError)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValue({ data: 'success' });

      await withRetry(mockFn, {
        maxRetries: 2,
        initialDelay: 5000,
        backoffMultiplier: 3,
        maxDelay: 8000,
      });

      global.setTimeout = originalSetTimeout;

      expect(delays[0]).toBe(5000);
      expect(delays[1]).toBe(8000); // Capped at maxDelay, not 15000
    });
  });

  describe('RateLimiter', () => {
    test('should consume tokens successfully', () => {
      const limiter = new RateLimiter(10, 10);

      expect(limiter.tryConsume()).toBe(true);
      expect(limiter.tokens).toBeLessThan(10);
    });

    test('should refill tokens over time', async () => {
      const limiter = new RateLimiter(100, 10); // 100 tokens per second

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryConsume();
      }

      expect(limiter.tryConsume()).toBe(false);

      // Wait 100ms (should refill ~10 tokens at 100/s rate)
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(limiter.tryConsume()).toBe(true);
    });

    test('should not exceed capacity', async () => {
      const limiter = new RateLimiter(100, 5);

      // Wait for refill
      await new Promise((resolve) => setTimeout(resolve, 200));

      limiter.refill();

      expect(limiter.tokens).toBeLessThanOrEqual(5);
    });

    test('waitAndConsume should wait for token availability', async () => {
      const limiter = new RateLimiter(10, 2);

      // Consume all tokens
      limiter.tryConsume();
      limiter.tryConsume();

      const startTime = Date.now();

      // This should wait for refill
      await limiter.waitAndConsume(1000);

      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThan(50); // Should have waited
    });

    test('waitAndConsume should timeout if token not available', async () => {
      const limiter = new RateLimiter(0.1, 1); // Very slow refill

      // Consume token
      limiter.tryConsume();

      // Carries a 503 so the error middleware reports back-pressure instead of
      // a backend fault, and tells the caller it is worth retrying.
      await expect(limiter.waitAndConsume(100)).rejects.toMatchObject({
        statusCode: 503,
        errorCode: 'upstream_rate_limited',
      });
    });
  });

  describe('RATE_LIMITS configuration', () => {
    test('should have valid free tier limits', () => {
      expect(RATE_LIMITS.FREE_TIER.requestsPerSecond).toBeGreaterThan(0);
      expect(RATE_LIMITS.FREE_TIER.burstSize).toBeGreaterThan(0);
      expect(RATE_LIMITS.FREE_TIER.burstSize).toBeGreaterThanOrEqual(
        RATE_LIMITS.FREE_TIER.requestsPerSecond
      );
    });

    test('should have valid paid tier limits', () => {
      expect(RATE_LIMITS.PAID_TIER.requestsPerSecond).toBeGreaterThan(0);
      expect(RATE_LIMITS.PAID_TIER.burstSize).toBeGreaterThan(0);
      expect(RATE_LIMITS.PAID_TIER.requestsPerSecond).toBeGreaterThan(
        RATE_LIMITS.FREE_TIER.requestsPerSecond
      );
    });
  });
});
