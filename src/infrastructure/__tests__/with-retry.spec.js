'use strict';

/**
 * Direct spec for the shared with-retry factory + getRetryAfter helper.
 * The per-provider rate-limiter specs (jupiter / coingecko / helius) cover
 * their own configurations indirectly; this spec exercises the factory's
 * uncovered branches in isolation:
 *   - getRetryAfter: numeric / HTTP-date / non-parseable / missing
 *   - honorRetryAfter=false ignores the header even when present
 *   - exponential backoff cap respects maxDelay
 *   - calculateBackoffDelay arithmetic
 */

const {
  createWithRetry,
  getRetryAfter,
  isRetryableError,
  calculateBackoffDelay,
} = require('../rate-limiting/with-retry');

describe('getRetryAfter', () => {
  test('returns null when no response on the error', () => {
    expect(getRetryAfter(new Error('network'))).toBeNull();
  });

  test('returns null when response.headers is missing', () => {
    expect(getRetryAfter({ response: {} })).toBeNull();
  });

  test('returns null when retry-after header is absent', () => {
    expect(getRetryAfter({ response: { headers: {} } })).toBeNull();
  });

  test('parses numeric retry-after as seconds → ms', () => {
    expect(getRetryAfter({ response: { headers: { 'retry-after': '5' } } })).toBe(5000);
    expect(getRetryAfter({ response: { headers: { 'retry-after': '0' } } })).toBe(0);
  });

  test('parses HTTP-date retry-after into milliseconds-from-now', () => {
    const future = new Date(Date.now() + 4_000).toUTCString();
    const delay = getRetryAfter({ response: { headers: { 'retry-after': future } } });
    expect(delay).toBeGreaterThanOrEqual(3_000);
    expect(delay).toBeLessThanOrEqual(5_000);
  });

  test('clamps past HTTP-date retry-after to 0', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(getRetryAfter({ response: { headers: { 'retry-after': past } } })).toBe(0);
  });

  test('returns null for non-numeric, non-date strings', () => {
    expect(getRetryAfter({ response: { headers: { 'retry-after': 'soon-ish' } } })).toBeNull();
  });
});

describe('isRetryableError', () => {
  test('treats network errors (no response) as retryable', () => {
    expect(isRetryableError(new Error('boom'))).toBe(true);
  });
  test('treats 429 as retryable', () => {
    expect(isRetryableError({ response: { status: 429 } })).toBe(true);
  });
  test('treats 5xx as retryable', () => {
    expect(isRetryableError({ response: { status: 500 } })).toBe(true);
    expect(isRetryableError({ response: { status: 503 } })).toBe(true);
    expect(isRetryableError({ response: { status: 599 } })).toBe(true);
  });
  test('treats 4xx (other than 429) as non-retryable', () => {
    expect(isRetryableError({ response: { status: 400 } })).toBe(false);
    expect(isRetryableError({ response: { status: 401 } })).toBe(false);
    expect(isRetryableError({ response: { status: 404 } })).toBe(false);
  });
  test('treats 3xx and 2xx as non-retryable', () => {
    expect(isRetryableError({ response: { status: 304 } })).toBe(false);
    expect(isRetryableError({ response: { status: 200 } })).toBe(false);
  });
});

describe('calculateBackoffDelay', () => {
  test('grows exponentially up to maxDelay', () => {
    expect(calculateBackoffDelay(0, 1000, 2, 10000)).toBe(1000);
    expect(calculateBackoffDelay(1, 1000, 2, 10000)).toBe(2000);
    expect(calculateBackoffDelay(2, 1000, 2, 10000)).toBe(4000);
    expect(calculateBackoffDelay(3, 1000, 2, 10000)).toBe(8000);
    // capped
    expect(calculateBackoffDelay(4, 1000, 2, 10000)).toBe(10000);
    expect(calculateBackoffDelay(10, 1000, 2, 10000)).toBe(10000);
  });
});

describe('createWithRetry — honorRetryAfter behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('honorRetryAfter=true uses the header when present', async () => {
    const withRetry = createWithRetry({
      maxRetries: 1,
      initialDelay: 9999,
      maxDelay: 9999,
      honorRetryAfter: true,
    });

    const requestFn = jest
      .fn()
      .mockRejectedValueOnce({
        response: { status: 429, headers: { 'retry-after': '1' } },
      })
      .mockResolvedValueOnce('ok');

    const promise = withRetry(requestFn);
    await jest.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toBe('ok');
  });

  test('honorRetryAfter=false ignores retry-after even when present', async () => {
    const withRetry = createWithRetry({
      maxRetries: 1,
      initialDelay: 50,
      maxDelay: 1000,
      honorRetryAfter: false,
    });

    const requestFn = jest
      .fn()
      .mockRejectedValueOnce({
        response: { status: 429, headers: { 'retry-after': '60' } },
      })
      .mockResolvedValueOnce('ok');

    const promise = withRetry(requestFn);
    // Header would say 60 seconds; with honor=false we use the 50ms backoff.
    await jest.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toBe('ok');
  });

  test('per-call options override factory defaults', async () => {
    const withRetry = createWithRetry({
      maxRetries: 0,
      initialDelay: 100,
      maxDelay: 1000,
    });

    const requestFn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 503, headers: {} } })
      .mockResolvedValueOnce('ok');

    // Factory default maxRetries=0 would fail immediately; per-call override = 1.
    const promise = withRetry(requestFn, { maxRetries: 1, initialDelay: 50 });
    await jest.advanceTimersByTimeAsync(150);
    await expect(promise).resolves.toBe('ok');
  });
});
