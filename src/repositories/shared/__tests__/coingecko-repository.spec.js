'use strict';

/**
 * CoinGecko repository `saveChart` TTL-branching unit tests.
 *
 * Focus: long-history charts (`days === 'max' | 'ytd' | > 30`) must be
 * cached with the long-history TTLs (1h short-term / 24h long-term);
 * everything else gets the standard tiers (5min / 6h). The cache helper
 * is mocked so no Redis is involved.
 */

jest.mock('../../helper', () => ({
  getCacheKey: jest.fn((suffix) => suffix),
  getFromCache: jest.fn(),
  storeInCache: jest.fn().mockResolvedValue(undefined),
}));

const { storeInCache } = require('../../helper');
const coingeckoRepository = require('../coingecko-repository');

const LONG_HISTORY_SHORT_TTL = 3600; // 1 hour
const LONG_HISTORY_LONG_TTL = 86400; // 24 hours
const SHORT_HISTORY_SHORT_TTL = 300; // 5 minutes
const SHORT_HISTORY_LONG_TTL = 21600; // 6 hours

const chartData = [[1700000000, 1.23]];

const saveChartFor = async (days) => {
  storeInCache.mockClear();
  await coingeckoRepository.saveChart({ coinId: 'solana', days, currency: 'usd' }, chartData, {});
  return storeInCache.mock.calls.map(([, , ttl]) => ttl);
};

describe('saveChart() TTL branching', () => {
  test.each(['max', 'ytd', 45])('uses long-history TTLs for days=%s', async (days) => {
    // Act
    const ttls = await saveChartFor(days);

    // Assert: short-term key stored first, long-term key second.
    expect(ttls).toEqual([LONG_HISTORY_SHORT_TTL, LONG_HISTORY_LONG_TTL]);
  });

  test('uses short-history TTLs for days=7', async () => {
    // Act
    const ttls = await saveChartFor(7);

    // Assert
    expect(ttls).toEqual([SHORT_HISTORY_SHORT_TTL, SHORT_HISTORY_LONG_TTL]);
  });
});
