'use strict';

jest.mock('../../../repositories/data-source', () => {
  const { FakeRedis } = require('../../../__tests__/helpers/fake-redis');
  return { redis: new FakeRedis() };
});

const { redis } = require('../../../repositories/data-source');
const limiter = require('../shared-rate-limiter');

const profile = { name: 'stub', rps: 10, burst: 2 };

describe('shared-rate-limiter', () => {
  let warn;
  beforeEach(() => {
    jest.useRealTimers();
    redis.map.clear();
    redis.calls.length = 0;
    redis.failing = false;
    limiter.resetLocal();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('shares one bucket across "containers": burst tokens go first, the next call waits for a refill', async () => {
    const started = Date.now();
    // two callers = two containers, same Redis key
    await Promise.all([limiter.acquire(profile), limiter.acquire(profile)]);
    expect(Date.now() - started).toBeLessThan(50);

    await limiter.acquire(profile); // bucket empty → waits ~100 ms for 1 token at 10 rps
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(redis.calls.filter(([cmd]) => cmd === 'eval').length).toBeGreaterThanOrEqual(4);
  });

  it('answers 503 upstream_rate_limited when the wait exceeds the request budget', async () => {
    await limiter.acquire(profile);
    await limiter.acquire(profile);
    await expect(limiter.acquire(profile, { deadline: Date.now() + 20 })).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'upstream_rate_limited',
    });
  });

  it('falls back to the in-memory bucket when Redis errors, warning once', async () => {
    redis.failing = true;
    await limiter.acquire(profile);
    await limiter.acquire(profile);
    await expect(limiter.acquire(profile, { deadline: Date.now() + 20 })).rejects.toMatchObject({
      errorCode: 'upstream_rate_limited',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/in-memory limiter/);
  });
});
