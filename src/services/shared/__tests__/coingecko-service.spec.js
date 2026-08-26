'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

jest.mock('../../../repositories/shared/coingecko-repository', () => ({
  getTokensPrices: jest.fn(),
  getShortTermChart: jest.fn(),
  getLongTermChart: jest.fn(),
  saveChart: jest.fn(),
  getShortTermCoinInfo: jest.fn(),
  getLongTermCoinInfo: jest.fn(),
  saveCoinInfo: jest.fn(),
  getShortTermExchangeRates: jest.fn(),
  getLongTermExchangeRates: jest.fn(),
  saveExchangeRates: jest.fn(),
}));

jest.mock('../../../infrastructure/rate-limiting/coingecko-rate-limiter', () => ({
  rateLimiter: {
    waitAndConsume: jest.fn().mockResolvedValue(undefined),
  },
  withRetry: jest.fn(async (operation) => operation()),
}));

const http = require('axios');
const repository = require('../../../repositories/shared/coingecko-repository');
const {
  rateLimiter,
  withRetry,
} = require('../../../infrastructure/rate-limiting/coingecko-rate-limiter');
const service = require('../coingecko-service');

describe('coingecko-service', () => {
  const locals = {
    network: {
      id: 'solana-mainnet',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimiter.waitAndConsume.mockResolvedValue(undefined);
    withRetry.mockImplementation(async (operation) => operation());
  });

  it('normalizes max market-chart requests to the free-tier limit and caches the raw timeframe', async () => {
    repository.getShortTermChart.mockResolvedValue(null);
    http.get.mockResolvedValue({
      data: {
        prices: [[1, 10]],
        market_caps: [[1, 100]],
        total_volumes: [[1, 5]],
      },
    });

    const result = await service.getMarketChart(
      { coinId: 'solana', days: 'max', currency: 'usd' },
      locals
    );

    expect(http.get).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/coins/solana/market_chart',
      {
        params: {
          vs_currency: 'usd',
          days: 365,
        },
        timeout: 5000,
      }
    );
    expect(repository.saveChart).toHaveBeenCalledWith(
      { coinId: 'solana', days: 'max', currency: 'usd' },
      {
        coinId: 'solana',
        currency: 'usd',
        days: 'max',
        prices: [[1, 10]],
        marketCaps: [[1, 100]],
        totalVolumes: [[1, 5]],
      },
      locals
    );
    expect(result).toEqual({
      coinId: 'solana',
      currency: 'usd',
      days: 'max',
      prices: [[1, 10]],
      marketCaps: [[1, 100]],
      totalVolumes: [[1, 5]],
    });
  });

  it.each([['400'], [400], ['99999']])(
    'clamps the numeric day window %s to the free-tier maximum',
    async (days) => {
      repository.getShortTermChart.mockResolvedValue(null);
      http.get.mockResolvedValue({
        data: { prices: [[1, 10]], market_caps: [[1, 100]], total_volumes: [[1, 5]] },
      });

      // Past the free-tier window CoinGecko answers 401 (paid feature), which
      // surfaced to the client as 500 server_error.
      await service.getMarketChart({ coinId: 'solana', days, currency: 'usd' }, locals);

      expect(http.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ params: expect.objectContaining({ days: 365 }) })
      );
    }
  );

  it('leaves a window inside the free tier untouched', async () => {
    repository.getShortTermChart.mockResolvedValue(null);
    http.get.mockResolvedValue({
      data: { prices: [[1, 10]], market_caps: [[1, 100]], total_volumes: [[1, 5]] },
    });

    await service.getMarketChart({ coinId: 'solana', days: 30, currency: 'usd' }, locals);

    expect(http.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ params: expect.objectContaining({ days: 30 }) })
    );
  });

  it('falls back to long-term cached chart data when CoinGecko fails', async () => {
    const cached = { coinId: 'solana', prices: [[1, 11]] };
    repository.getShortTermChart.mockResolvedValue(null);
    repository.getLongTermChart.mockResolvedValue(cached);
    withRetry.mockRejectedValue(new Error('coingecko unavailable'));

    const result = await service.getMarketChart(
      { coinId: 'solana', days: 7, currency: 'usd' },
      locals
    );

    expect(repository.getLongTermChart).toHaveBeenCalledWith(
      { coinId: 'solana', days: 7, currency: 'usd' },
      locals
    );
    expect(result).toBe(cached);
  });

  it('normalizes CoinGecko coin info into the API shape and caches it', async () => {
    repository.getShortTermCoinInfo.mockResolvedValue(null);
    http.get.mockResolvedValue({
      data: {
        id: 'solana',
        symbol: 'sol',
        name: 'Solana',
        image: { large: 'https://img/sol.png' },
        description: { en: 'High-performance chain' },
        links: {
          homepage: ['https://solana.com'],
          twitter_screen_name: 'solana',
        },
        market_data: {
          current_price: { usd: 150 },
          price_change_24h: 5,
          price_change_percentage_24h: 3.2,
          market_cap: { usd: 1000 },
          market_cap_rank: 5,
          total_volume: { usd: 400 },
          high_24h: { usd: 155 },
          low_24h: { usd: 145 },
          circulating_supply: 100,
          total_supply: 200,
          max_supply: 300,
          ath: { usd: 260 },
          ath_change_percentage: { usd: -40 },
          ath_date: { usd: '2021-11-06T00:00:00.000Z' },
          atl: { usd: 0.5 },
          atl_change_percentage: { usd: 29900 },
          atl_date: { usd: '2020-05-11T00:00:00.000Z' },
        },
      },
    });

    const result = await service.getCoinInfo({ coinId: 'solana', currency: 'usd' }, locals);

    expect(repository.saveCoinInfo).toHaveBeenCalledWith(
      { coinId: 'solana', currency: 'usd' },
      expect.objectContaining({
        id: 'solana',
        symbol: 'sol',
        name: 'Solana',
        image: 'https://img/sol.png',
        description: 'High-performance chain',
        links: {
          homepage: 'https://solana.com',
          twitter: 'https://twitter.com/solana',
        },
      }),
      locals
    );
    expect(result.marketData).toEqual({
      currentPrice: 150,
      priceChange24h: 5,
      priceChangePercentage24h: 3.2,
      marketCap: 1000,
      marketCapRank: 5,
      totalVolume: 400,
      high24h: 155,
      low24h: 145,
      circulatingSupply: 100,
      totalSupply: 200,
      maxSupply: 300,
      ath: 260,
      athChangePercentage: -40,
      athDate: '2021-11-06T00:00:00.000Z',
      atl: 0.5,
      atlChangePercentage: 29900,
      atlDate: '2020-05-11T00:00:00.000Z',
    });
  });

  it('returns cached exchange rates without calling CoinGecko', async () => {
    const cached = {
      base: 'usd',
      timestamp: 1710000000,
      rates: { usd: 1, eur: 0.92 },
    };
    repository.getShortTermExchangeRates.mockResolvedValue(cached);

    const result = await service.getExchangeRates(locals);

    expect(result).toBe(cached);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('normalizes CoinGecko BTC-based exchange rates into USD-based fiat rates', async () => {
    repository.getShortTermExchangeRates.mockResolvedValue(null);
    http.get.mockResolvedValue({
      data: {
        rates: {
          usd: { value: 50000 },
          eur: { value: 46000 },
          gbp: { value: 39500 },
          jpy: { value: 7500000 },
        },
      },
    });

    const result = await service.getExchangeRates(locals);

    expect(http.get).toHaveBeenCalledWith('https://api.coingecko.com/api/v3/exchange_rates', {
      params: {},
      timeout: 2000,
    });
    expect(repository.saveExchangeRates).toHaveBeenCalledWith(result, locals);
    expect(result).toEqual({
      base: 'usd',
      timestamp: expect.any(Number),
      rates: expect.objectContaining({
        usd: 1,
        eur: 0.92,
        gbp: 0.79,
        jpy: 150,
      }),
    });
  });

  it('falls back to long-term cached exchange rates when CoinGecko fails', async () => {
    const cached = {
      base: 'usd',
      timestamp: 1710000000,
      rates: { usd: 1, eur: 0.91 },
    };
    repository.getShortTermExchangeRates.mockResolvedValue(null);
    repository.getLongTermExchangeRates.mockResolvedValue(cached);
    withRetry.mockRejectedValue(new Error('coingecko unavailable'));

    const result = await service.getExchangeRates(locals);

    expect(repository.getLongTermExchangeRates).toHaveBeenCalledWith(locals);
    expect(result).toBe(cached);
  });

  it('falls back to long-term cached exchange rates when CoinGecko omits the USD base rate', async () => {
    const cached = {
      base: 'usd',
      timestamp: 1710000000,
      rates: { usd: 1, eur: 0.91 },
    };
    repository.getShortTermExchangeRates.mockResolvedValue(null);
    repository.getLongTermExchangeRates.mockResolvedValue(cached);
    http.get.mockResolvedValue({
      data: {
        rates: {
          eur: { value: 46000 },
        },
      },
    });

    const result = await service.getExchangeRates(locals);

    expect(repository.getLongTermExchangeRates).toHaveBeenCalledWith(locals);
    expect(repository.saveExchangeRates).not.toHaveBeenCalled();
    expect(result).toBe(cached);
  });

  it('getContractMarketChart fetches by contract address and maps the chart shape', async () => {
    const locals = {};
    repository.getShortTermChart.mockResolvedValue(null);
    http.get.mockResolvedValue({
      data: { prices: [[1, 2]], market_caps: [[1, 3]], total_volumes: [[1, 4]] },
    });

    const result = await service.getContractMarketChart(
      { platform: 'solana', contractAddress: 'EPjFmint', days: 7 },
      locals
    );

    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.coingecko.com/api/v3/coins/solana/contract/EPjFmint/market_chart'
    );
    expect(result).toEqual({
      platform: 'solana',
      contractAddress: 'EPjFmint',
      currency: 'usd',
      days: 7,
      prices: [[1, 2]],
      marketCaps: [[1, 3]],
      totalVolumes: [[1, 4]],
    });
    expect(repository.saveChart).toHaveBeenCalledWith(
      { coinId: 'solana:EPjFmint', days: 7, currency: 'usd' },
      result,
      locals
    );
  });

  it('getContractMarketChart serves the short-term cache without fetching', async () => {
    const cached = { platform: 'solana', prices: [] };
    repository.getShortTermChart.mockResolvedValue(cached);

    const result = await service.getContractMarketChart(
      { platform: 'solana', contractAddress: 'EPjFmint' },
      {}
    );

    expect(http.get).not.toHaveBeenCalled();
    expect(result).toBe(cached);
  });

  it('getContractCoinInfo fetches by contract address and maps the coin-info shape', async () => {
    const locals = {};
    repository.getShortTermCoinInfo.mockResolvedValue(null);
    http.get.mockResolvedValue({
      data: {
        id: 'jupiter-exchange-solana',
        symbol: 'jup',
        name: 'Jupiter',
        image: { large: 'https://img/jup-large.png' },
        description: { en: 'DEX aggregator on Solana.' },
        links: { homepage: ['https://jup.ag'], twitter_screen_name: 'JupiterExchange' },
        market_data: {
          current_price: { usd: 0.5 },
          market_cap: { usd: 1000 },
          market_cap_rank: 60,
          total_volume: { usd: 200 },
          circulating_supply: 7,
          ath: { usd: 2 },
          ath_date: { usd: '2024-01-31' },
          atl: { usd: 0.3 },
          atl_date: { usd: '2024-08-05' },
        },
      },
    });

    const result = await service.getContractCoinInfo(
      { platform: 'solana', contractAddress: 'JUPmint' },
      locals
    );

    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.coingecko.com/api/v3/coins/solana/contract/JUPmint'
    );
    expect(result.id).toBe('jupiter-exchange-solana');
    expect(result.name).toBe('Jupiter');
    expect(result.description).toBe('DEX aggregator on Solana.');
    expect(result.links).toEqual({
      homepage: 'https://jup.ag',
      twitter: 'https://twitter.com/JupiterExchange',
    });
    expect(result.marketData).toMatchObject({
      currentPrice: 0.5,
      marketCap: 1000,
      marketCapRank: 60,
      totalVolume: 200,
      circulatingSupply: 7,
      ath: 2,
      atl: 0.3,
    });
    expect(repository.saveCoinInfo).toHaveBeenCalledWith(
      { coinId: 'solana:JUPmint', currency: 'usd' },
      result,
      locals
    );
  });

  it('getContractCoinInfo serves the short-term cache without fetching', async () => {
    const cached = { id: 'jupiter-exchange-solana', name: 'Jupiter' };
    repository.getShortTermCoinInfo.mockResolvedValue(cached);

    const result = await service.getContractCoinInfo(
      { platform: 'solana', contractAddress: 'JUPmint' },
      {}
    );

    expect(http.get).not.toHaveBeenCalled();
    expect(result).toBe(cached);
  });

  it('getContractCoinInfo falls back to the long-term cache on fetch failure', async () => {
    const cached = { id: 'jupiter-exchange-solana', name: 'Jupiter' };
    repository.getShortTermCoinInfo.mockResolvedValue(null);
    repository.getLongTermCoinInfo.mockResolvedValue(cached);
    http.get.mockRejectedValue(new Error('upstream down'));

    const result = await service.getContractCoinInfo(
      { platform: 'solana', contractAddress: 'JUPmint' },
      {}
    );

    expect(repository.getLongTermCoinInfo).toHaveBeenCalledWith(
      { coinId: 'solana:JUPmint', currency: 'usd' },
      {}
    );
    expect(repository.saveCoinInfo).not.toHaveBeenCalled();
    expect(result).toBe(cached);
  });
});
