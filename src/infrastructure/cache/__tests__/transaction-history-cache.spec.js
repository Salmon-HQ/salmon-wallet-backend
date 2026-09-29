'use strict';

/**
 * The transaction-history routes fold the caller's whole query object into
 * the cache key, so an anonymous caller varying any parameter — including one
 * no loader reads — mints a new key per request. Nothing ever looks those
 * keys up a second time, so the lazy TTL eviction never fires for them and
 * the map grows for the life of the warm container.
 */

const {
  MAX_CACHE_ENTRIES,
  buildCacheKey,
  clearTransactionHistoryCache,
  withCachedTransactionHistory,
} = require('../transaction-history-cache');

beforeEach(() => {
  clearTransactionHistoryCache();
});

describe('cache size bound', () => {
  const load = (key) => withCachedTransactionHistory(key, async () => ({ items: [key] }));

  test('never grows past the cap, however many distinct keys arrive', async () => {
    for (let i = 0; i < MAX_CACHE_ENTRIES + 250; i += 1) {
      await load(buildCacheKey('solana-transactions', 'addr', { junk: `v${i}` }, {}));
    }

    expect(require('../transaction-history-cache').__testing.size()).toBe(MAX_CACHE_ENTRIES);
  });

  test('a key still serves its own cached value within the TTL', async () => {
    const key = buildCacheKey('solana-transactions', 'addr', {}, {});
    const loader = jest.fn().mockResolvedValue({ items: ['x'] });

    await withCachedTransactionHistory(key, loader);
    const second = await withCachedTransactionHistory(key, loader);

    expect(second).toEqual({ items: ['x'] });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
