'use strict';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../../infrastructure/rate-limiting/jupiter-rate-limiter', () => ({
  withRetry: jest.fn(async (fn) => fn()),
  rateLimiter: { waitAndConsume: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../infrastructure/cache/price-cache', () => ({
  getQuoteWithCache: jest.fn(),
  readCachedQuotes: jest.fn(),
  setCachedQuote: jest.fn().mockResolvedValue(undefined),
}));

const http = require('axios');
const cache = require('../../../infrastructure/cache/price-cache');
const jupiterService = require('../jupiter-service');

describe('jupiter-service.getQuotes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JUPITER_PRICE_URL = 'https://example.test/price/v3';
    delete process.env.JUPITER_API_KEY;
  });

  it('returns empty map for empty input without hitting cache or HTTP', async () => {
    const result = await jupiterService.getQuotes([], {});
    expect(result.size).toBe(0);
    expect(cache.readCachedQuotes).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  });

  it('serves entirely from cache when every mint is a hit (no HTTP call)', async () => {
    cache.readCachedQuotes.mockResolvedValue({
      hits: new Map([
        ['mint-A', { usdPrice: 1, priceChange24h: 0.1 }],
        ['mint-B', { usdPrice: 2, priceChange24h: -0.2 }],
      ]),
      misses: [],
    });

    const result = await jupiterService.getQuotes(['mint-A', 'mint-B'], {});

    expect(http.get).not.toHaveBeenCalled();
    expect(cache.setCachedQuote).not.toHaveBeenCalled();
    expect(result.get('mint-A')).toEqual({ usdPrice: 1, priceChange24h: 0.1 });
    expect(result.get('mint-B')).toEqual({ usdPrice: 2, priceChange24h: -0.2 });
  });

  it('fetches only cache misses from Jupiter and merges with hits', async () => {
    cache.readCachedQuotes.mockResolvedValue({
      hits: new Map([['cached-mint', { usdPrice: 5, priceChange24h: 0.05 }]]),
      misses: ['fresh-mint'],
    });
    http.get.mockResolvedValue({
      data: {
        'fresh-mint': { usdPrice: 7.5, priceChange24h: -1.2, decimals: 6 },
      },
    });

    const result = await jupiterService.getQuotes(['cached-mint', 'fresh-mint'], {});

    expect(http.get).toHaveBeenCalledTimes(1);
    const url = http.get.mock.calls[0][0];
    expect(url).toContain('ids=fresh-mint');
    expect(url).not.toContain('cached-mint');

    expect(cache.setCachedQuote).toHaveBeenCalledWith(
      'fresh-mint',
      { usdPrice: 7.5, priceChange24h: -1.2 },
      {}
    );
    expect(result.get('cached-mint')).toEqual({ usdPrice: 5, priceChange24h: 0.05 });
    expect(result.get('fresh-mint')).toEqual({ usdPrice: 7.5, priceChange24h: -1.2 });
  });

  it('omits mints Jupiter returns without usdPrice', async () => {
    cache.readCachedQuotes.mockResolvedValue({
      hits: new Map(),
      misses: ['priced', 'unknown'],
    });
    http.get.mockResolvedValue({
      data: {
        priced: { usdPrice: 0.42, priceChange24h: 3.14 },
        unknown: { decimals: 9 },
      },
    });

    const result = await jupiterService.getQuotes(['priced', 'unknown'], {});

    expect(result.has('priced')).toBe(true);
    expect(result.has('unknown')).toBe(false);
    expect(cache.setCachedQuote).toHaveBeenCalledTimes(1);
    expect(cache.setCachedQuote).toHaveBeenCalledWith(
      'priced',
      { usdPrice: 0.42, priceChange24h: 3.14 },
      {}
    );
  });

  it('deduplicates input mints before reading cache', async () => {
    cache.readCachedQuotes.mockResolvedValue({
      hits: new Map([['mint-A', { usdPrice: 1, priceChange24h: 0 }]]),
      misses: [],
    });

    await jupiterService.getQuotes(['mint-A', 'mint-A', 'mint-A'], {});

    expect(cache.readCachedQuotes).toHaveBeenCalledWith(['mint-A'], {});
  });

  it('survives Jupiter failure by returning only the cache hits', async () => {
    cache.readCachedQuotes.mockResolvedValue({
      hits: new Map([['cached', { usdPrice: 1, priceChange24h: 0 }]]),
      misses: ['will-fail'],
    });
    http.get.mockRejectedValue(new Error('jupiter 500'));

    const result = await jupiterService.getQuotes(['cached', 'will-fail'], {});

    expect(result.size).toBe(1);
    expect(result.get('cached')).toEqual({ usdPrice: 1, priceChange24h: 0 });
    expect(cache.setCachedQuote).not.toHaveBeenCalled();
  });
});
