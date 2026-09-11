'use strict';

jest.mock('../../../repositories/data-source', () => {
  const { FakeRedis } = require('../../../__tests__/helpers/fake-redis');
  return { redis: new FakeRedis() };
});

const { redis } = require('../../../repositories/data-source');
const breaker = require('../circuit-breaker');

const policy = { failures: 2, cooldownMs: 50 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('circuit-breaker', () => {
  beforeEach(() => {
    redis.map.clear();
    redis.failing = false;
    breaker.resetMemory();
    delete process.env.BREAKER_DISABLED;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens after N consecutive failures, allows one probe after the cooldown, closes on success', async () => {
    await breaker.check('p', 'mainnet', policy);
    expect(await breaker.recordFailure('p', 'mainnet', policy)).toBe(false);
    expect(await breaker.recordFailure('p', 'mainnet', policy)).toBe(true);
    await expect(breaker.check('p', 'mainnet', policy)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'upstream_unavailable',
    });

    await sleep(60);
    await breaker.check('p', 'mainnet', policy); // the single probe
    await expect(breaker.check('p', 'mainnet', policy)).rejects.toMatchObject({
      errorCode: 'upstream_unavailable',
    });

    await breaker.recordSuccess('p', 'mainnet', policy);
    await breaker.check('p', 'mainnet', policy);
  });

  it('re-opens when the probe fails', async () => {
    await breaker.recordFailure('p', 'mainnet', policy);
    await breaker.recordFailure('p', 'mainnet', policy);
    await sleep(60);
    await breaker.check('p', 'mainnet', policy);
    expect(await breaker.recordFailure('p', 'mainnet', policy)).toBe(true);
    await expect(breaker.check('p', 'mainnet', policy)).rejects.toMatchObject({
      errorCode: 'upstream_unavailable',
    });
  });

  it('isolates state per provider and environment', async () => {
    await breaker.recordFailure('p', 'devnet', policy);
    await breaker.recordFailure('p', 'devnet', policy);
    await expect(breaker.check('p', 'devnet', policy)).rejects.toBeDefined();
    await breaker.check('p', 'mainnet', policy);
    await breaker.check('q', 'devnet', policy);
  });

  it('bypasses everything with BREAKER_DISABLED=true and a null policy', async () => {
    process.env.BREAKER_DISABLED = 'true';
    await breaker.recordFailure('p', 'mainnet', policy);
    await breaker.recordFailure('p', 'mainnet', policy);
    await breaker.check('p', 'mainnet', policy);
    delete process.env.BREAKER_DISABLED;
    await breaker.check('p', 'mainnet', null);
  });

  it('keeps working in memory when Redis errors', async () => {
    redis.failing = true;
    await breaker.recordFailure('p', 'mainnet', policy);
    await breaker.recordFailure('p', 'mainnet', policy);
    await expect(breaker.check('p', 'mainnet', policy)).rejects.toMatchObject({
      errorCode: 'upstream_unavailable',
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
