'use strict';

/**
 * Against the real Redis from `.env`: the Lua bucket is atomic under
 * concurrency (never more than `burst` tokens handed out at once) and
 * `withSingleFlight` rebuilds once for many concurrent callers. Skips when
 * Redis does not answer.
 */

const { redis } = require('../../../repositories/data-source');
const limiter = require('../shared-rate-limiter');
const cache = require('../../cache/cache-helper');

const profile = { name: `itest-${process.pid}`, rps: 1, burst: 5 };
const KEY = `salmon-api:itest:${process.pid}:single_flight`;

let reachable = false;

beforeAll(async () => {
  try {
    await redis.ping();
    reachable = true;
  } catch {
    console.warn('Redis unreachable, skipping provider-resilience integration suite');
  }
});

afterAll(async () => {
  if (!reachable) return;
  await redis.del([
    `ratelimit:${process.env.STAGE}:${profile.name}`,
    KEY,
    `${KEY}:stale`,
    `${KEY}:lock`,
  ]);
  await redis.quit();
});

describe('provider resilience against Redis', () => {
  it('hands out exactly `burst` tokens to 20 concurrent callers, the rest wait or 503', async () => {
    if (!reachable) return;
    const locals = { deadline: Date.now() + 200 };
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => limiter.acquire(profile, locals))
    );
    const granted = results.filter((r) => r.status === 'fulfilled');
    expect(granted).toHaveLength(profile.burst);
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect(r.reason.errorCode).toBe('upstream_rate_limited');
    }
  });

  it('rebuilds a single-flight entry once for 10 concurrent callers', async () => {
    if (!reachable) return;
    const rebuild = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { built: true };
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        cache.withSingleFlight(KEY, { ttl: 30, staleTtl: 60, lockMs: 2000, rebuild })
      )
    );
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.built === true)).toBe(true);
  });
});
