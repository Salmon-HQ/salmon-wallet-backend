'use strict';

/**
 * price-cache `getQuoteWithCache` unit tests.
 *
 * Focus: the cache-hit short circuit, the "only cache quotes with a
 * usdPrice" rule, and the swallow-and-continue behavior on Redis errors.
 * The cache helper is mocked so no Redis is involved.
 */

jest.mock('../cache-helper', () => ({
  getFromCache: jest.fn(),
  storeInCache: jest.fn().mockResolvedValue(undefined),
  getCacheKeyFor: jest.fn((entity, property, value) => `${entity}_by_${property}:${value}`),
}));

const { getFromCache, storeInCache } = require('../cache-helper');
const { getQuoteWithCache } = require('../price-cache');

let consoleWarnSpy;

beforeEach(() => {
  jest.clearAllMocks();
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
});

describe('getQuoteWithCache()', () => {
  test('returns the cached quote without calling fetchFn on a cache hit', async () => {
    // Arrange
    getFromCache.mockResolvedValue({ usdPrice: 1.5, priceChange24h: 2 });
    const fetchFn = jest.fn();

    // Act
    const result = await getQuoteWithCache('mintA', fetchFn);

    // Assert
    expect(result).toEqual({ usdPrice: 1.5, priceChange24h: 2 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('caches a fresh quote with usdPrice on a cache miss', async () => {
    // Arrange
    getFromCache.mockResolvedValue(null);
    const fetchFn = jest.fn().mockResolvedValue({ usdPrice: 3, priceChange24h: null });

    // Act
    const result = await getQuoteWithCache('mintA', fetchFn);

    // Assert
    expect(result).toEqual({ usdPrice: 3, priceChange24h: null });
    expect(storeInCache).toHaveBeenCalledWith(
      expect.stringContaining('mintA'),
      expect.objectContaining({ usdPrice: 3, priceChange24h: null }),
      300
    );
  });

  test('does not cache when fetchFn returns null', async () => {
    // Arrange
    getFromCache.mockResolvedValue(null);
    const fetchFn = jest.fn().mockResolvedValue(null);

    // Act
    const result = await getQuoteWithCache('mintA', fetchFn);

    // Assert
    expect(result).toBeNull();
    expect(storeInCache).not.toHaveBeenCalled();
  });

  test('passes through a quote without usdPrice uncached', async () => {
    // Arrange
    getFromCache.mockResolvedValue(null);
    const fetchFn = jest.fn().mockResolvedValue({ priceChange24h: 1 });

    // Act
    const result = await getQuoteWithCache('mintA', fetchFn);

    // Assert
    expect(result).toEqual({ priceChange24h: 1 });
    expect(storeInCache).not.toHaveBeenCalled();
  });

  test('swallows a Redis read error and falls back to fetchFn', async () => {
    // Arrange
    getFromCache.mockRejectedValue(new Error('redis down'));
    const fetchFn = jest.fn().mockResolvedValue({ usdPrice: 4, priceChange24h: 0 });

    // Act
    const result = await getQuoteWithCache('mintA', fetchFn);

    // Assert: read error logged, not thrown; fresh quote still returned.
    expect(result).toEqual({ usdPrice: 4, priceChange24h: 0 });
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  test('swallows a Redis write error and still returns the fresh quote', async () => {
    // Arrange
    getFromCache.mockResolvedValue(null);
    storeInCache.mockRejectedValue(new Error('redis down'));
    const fetchFn = jest.fn().mockResolvedValue({ usdPrice: 5, priceChange24h: 1 });

    // Act
    const result = await getQuoteWithCache('mintA', fetchFn);

    // Assert
    expect(result).toEqual({ usdPrice: 5, priceChange24h: 1 });
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});
