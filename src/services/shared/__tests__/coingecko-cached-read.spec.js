'use strict';

jest.mock('../../../repositories/shared/coingecko-repository', () => ({
  getShortTermExchangeRates: jest.fn(),
  getLongTermExchangeRates: jest.fn(),
  saveExchangeRates: jest.fn(),
  getShortTermCoinInfo: jest.fn(),
  getLongTermCoinInfo: jest.fn(),
  saveCoinInfo: jest.fn(),
}));
jest.mock('../../../infrastructure/cache/cache-helper', () => ({
  LOCK_POLL_MS: 1,
  tryLock: jest.fn(),
  releaseLock: jest.fn(),
  getCacheKey: (suffix) => `test:${suffix}`,
}));
jest.mock('../../../infrastructure/cache/price-cache', () => ({
  readCachedQuotes: jest.fn(),
  setCachedQuotes: jest.fn(),
}));
jest.mock('../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((_provider, fn) => fn({ timeout: 5000, signal: undefined })),
}));
jest.mock('axios', () => ({ get: jest.fn() }));

const http = require('axios');
const repository = require('../../../repositories/shared/coingecko-repository');
const { tryLock, releaseLock } = require('../../../infrastructure/cache/cache-helper');
const service = require('../coingecko-service');

const upstreamRates = { rates: { usd: { value: 1 }, eur: { value: 0.9 } } };
const locals = { requestDeadline: Date.now() + 5000 };

describe('coingecko cached reads: one flight per entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.getShortTermExchangeRates.mockResolvedValue(null);
    repository.getLongTermExchangeRates.mockResolvedValue(null);
    repository.getShortTermCoinInfo.mockResolvedValue(null);
    repository.getLongTermCoinInfo.mockResolvedValue(null);
    http.get.mockResolvedValue({ data: upstreamRates });
  });

  it('the lock holder fetches, saves and releases', async () => {
    tryLock.mockResolvedValue(true);
    const rates = await service.getExchangeRates(locals);
    expect(rates.base).toBe('usd');
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(repository.saveExchangeRates).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledWith(
      expect.stringContaining('coingecko_lock:exchange_rates')
    );
  });

  it('a caller that loses the lock serves the long-term copy without calling CoinGecko', async () => {
    tryLock.mockResolvedValue(false);
    repository.getLongTermExchangeRates.mockResolvedValue({ base: 'usd', rates: { usd: 1 } });
    const rates = await service.getExchangeRates(locals);
    expect(rates).toEqual({ base: 'usd', rates: { usd: 1 } });
    expect(http.get).not.toHaveBeenCalled();
  });

  it("a caller that loses the lock with no long-term copy waits for the holder's save", async () => {
    tryLock.mockResolvedValue(false);
    repository.getShortTermExchangeRates
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ base: 'usd', rates: { usd: 1, eur: 0.9 } });
    const rates = await service.getExchangeRates(locals);
    expect(rates.rates.eur).toBe(0.9);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('caches a 404 for the short term so an unlisted id costs one upstream call', async () => {
    tryLock.mockResolvedValue(true);
    const notFound = Object.assign(new Error('404'), { response: { status: 404 } });
    http.get.mockRejectedValue(notFound);
    await expect(service.getCoinInfo({ coinId: 'nope' }, locals)).rejects.toMatchObject({
      response: { status: 404 },
    });
    expect(repository.saveCoinInfo).toHaveBeenCalledWith(
      { coinId: 'nope', currency: 'usd' },
      { notFound: true },
      locals
    );
    repository.getShortTermCoinInfo.mockResolvedValue({ notFound: true });
    await expect(service.getCoinInfo({ coinId: 'nope' }, locals)).rejects.toMatchObject({
      response: { status: 404 },
    });
    expect(http.get).toHaveBeenCalledTimes(1);
  });
});
