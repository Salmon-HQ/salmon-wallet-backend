'use strict';

jest.mock('../circuit-breaker', () => ({
  check: jest.fn(),
  recordSuccess: jest.fn(),
  recordFailure: jest.fn().mockResolvedValue(false),
}));
jest.mock('../shared-rate-limiter', () => ({ acquire: jest.fn().mockResolvedValue(0) }));
jest.mock('../metrics', () => ({ emit: jest.fn() }));
jest.mock('../profiles', () => ({
  getProfile: jest.fn(() => ({
    name: 'stub',
    rps: 1,
    burst: 1,
    timeoutMs: 5000,
    retry: { maxAttempts: 3, baseMs: 10, maxMs: 40, honorRetryAfter: true },
    breaker: { failures: 5, cooldownMs: 1000 },
  })),
}));

const breaker = require('../circuit-breaker');
const limiter = require('../shared-rate-limiter');
const metrics = require('../metrics');
const { providerCall } = require('../provider-client');

const http = (status) => Object.assign(new Error(`status ${status}`), { response: { status } });

describe('providerCall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    breaker.recordFailure.mockResolvedValue(false);
    limiter.acquire.mockResolvedValue(0);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('runs the gates in order and hands fn a timeout capped by the remaining budget', async () => {
    const order = [];
    breaker.check.mockImplementation(async () => order.push('breaker'));
    limiter.acquire.mockImplementation(async () => order.push('limiter'));
    const fn = jest.fn(async (ctx) => {
      order.push('fn');
      return ctx;
    });

    const ctx = await providerCall('stub', fn, { locals: { deadline: Date.now() + 1000 } });

    expect(order).toEqual(['breaker', 'limiter', 'fn']);
    expect(ctx.timeout).toBeLessThanOrEqual(1000);
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(breaker.recordSuccess).toHaveBeenCalled();
    expect(metrics.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: { Provider: 'stub', Environment: 'global', Outcome: 'success' },
      })
    );
  });

  it('retries 5xx with backoff, then returns the result', async () => {
    const fn = jest.fn().mockRejectedValueOnce(http(502)).mockResolvedValueOnce('ok');
    await expect(providerCall('stub', fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(breaker.recordFailure).toHaveBeenCalledTimes(1);
    expect(metrics.emit).toHaveBeenCalledWith(
      expect.objectContaining({ metrics: expect.objectContaining({ Retries: 1 }) })
    );
  });

  it('does not retry a 4xx and does not count it against the breaker', async () => {
    const fn = jest.fn().mockRejectedValue(http(400));
    await expect(providerCall('stub', fn)).rejects.toMatchObject({ response: { status: 400 } });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(breaker.recordFailure).not.toHaveBeenCalled();
  });

  it('fails now when retry-after would land past the budget', async () => {
    const error = http(429);
    error.response.headers = { 'retry-after': '30' };
    const fn = jest.fn().mockRejectedValue(error);
    await expect(providerCall('stub', fn, { locals: { deadline: Date.now() + 500 } })).rejects.toBe(
      error
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(breaker.recordFailure).not.toHaveBeenCalled(); // 429 is the provider's throttle
  });

  it('refuses to start once the budget is spent', async () => {
    const fn = jest.fn();
    await expect(
      providerCall('stub', fn, { locals: { deadline: Date.now() - 1 } })
    ).rejects.toMatchObject({
      errorCode: 'request_budget_exhausted',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('fails fast while the breaker is open and records BreakerOpen', async () => {
    breaker.check.mockRejectedValueOnce(
      Object.assign(new Error('open'), { statusCode: 503, errorCode: 'upstream_unavailable' })
    );
    await expect(providerCall('stub', jest.fn(), { environment: 'devnet' })).rejects.toMatchObject({
      errorCode: 'upstream_unavailable',
    });
    expect(metrics.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: expect.objectContaining({
          Environment: 'devnet',
          Outcome: 'upstream_unavailable',
        }),
        metrics: expect.objectContaining({ BreakerOpen: 1 }),
      })
    );
  });
});
