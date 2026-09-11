'use strict';

jest.mock('../../../repositories/data-source', () => {
  const { FakeRedis } = require('../../../__tests__/helpers/fake-redis');
  return { redis: new FakeRedis() };
});

const { redis } = require('../../../repositories/data-source');
const cache = require('../cache-helper');

describe('cache-helper batched I/O', () => {
  beforeEach(() => {
    redis.map.clear();
    redis.calls.length = 0;
    redis.failing = false;
  });

  it('reads many keys with one MGET and parses each', async () => {
    await redis.set('a', JSON.stringify({ x: 1 }));
    const result = await cache.getManyFromCache(['a', 'b']);
    expect(result.get('a')).toEqual({ x: 1 });
    expect(result.get('b')).toBeNull();
    expect(redis.calls.filter(([cmd]) => cmd === 'mGet')).toHaveLength(1);
  });

  it('writes many entries with one MULTI and swallows Redis errors', async () => {
    await cache.storeManyInCache(
      [
        ['a', 1],
        ['b', 2],
      ],
      60
    );
    expect(redis.calls.filter(([cmd]) => cmd === 'setMany')).toHaveLength(1);
    expect(await redis.get('b')).toBe('2');
    redis.failing = true;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(cache.storeManyInCache([['c', 3]], 60)).resolves.toBeUndefined();
    expect((await cache.getManyFromCache(['c'])).get('c')).toBeNull();
  });
});

describe('withSingleFlight', () => {
  const options = (rebuild, extra = {}) => ({
    ttl: 60,
    staleTtl: 120,
    lockMs: 500,
    rebuild,
    ...extra,
  });

  beforeEach(() => {
    redis.map.clear();
    redis.failing = false;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('rebuilds once under concurrency and serves the stale copy to the others', async () => {
    await redis.set('k:stale', JSON.stringify('old'));
    const rebuild = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return 'new';
    });
    const results = await Promise.all(
      [1, 2, 3].map(() => cache.withSingleFlight('k', options(rebuild)))
    );
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(results.sort()).toEqual(['new', 'old', 'old']);
    expect(await cache.getFromCache('k')).toBe('new');
    expect(await redis.get('k:lock')).toBeNull();
  });

  it('makes waiters poll for the fresh value when there is no stale copy', async () => {
    const rebuild = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return 'built';
    });
    const results = await Promise.all([
      cache.withSingleFlight('k', options(rebuild)),
      cache.withSingleFlight('k', options(rebuild)),
    ]);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['built', 'built']);
  });

  it('serves the stale copy when the rebuild fails, and rethrows without one', async () => {
    const rebuild = jest.fn().mockRejectedValue(new Error('provider down'));
    await expect(cache.withSingleFlight('k', options(rebuild))).rejects.toThrow('provider down');
    await redis.set('k:stale', JSON.stringify('old'));
    await expect(cache.withSingleFlight('k', options(rebuild))).resolves.toBe('old');
  });

  it('returns a fresh value without touching the lock', async () => {
    await redis.set('k', JSON.stringify('fresh'));
    const rebuild = jest.fn();
    await expect(cache.withSingleFlight('k', options(rebuild))).resolves.toBe('fresh');
    expect(rebuild).not.toHaveBeenCalled();
  });
});
