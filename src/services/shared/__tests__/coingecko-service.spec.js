'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

jest.mock('../../../repositories/shared/coingecko-repository', () => ({
  getSolanaTokenList: jest.fn(),
  saveSolanaTokenList: jest.fn(),
  getSolanaCoinIds: jest.fn(),
  saveSolanaCoinIds: jest.fn(),
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

jest.mock('../../../infrastructure/cache/price-cache', () => ({
  readCachedQuotes: jest.fn(async (mints) => ({ hits: new Map(), misses: mints })),
  setCachedQuote: jest.fn(),
}));
jest.mock('../../../infrastructure/rate-limiting/coingecko-rate-limiter', () => ({
  rateLimiter: {
    waitAndConsume: jest.fn().mockResolvedValue(undefined),
  },
  withRetry: jest.fn(async (operation) => operation()),
}));

// jest.setup loads .env; a real key there would put a header on every call.
delete process.env.COINGECKO_API_KEY;

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

  it('encodes caller-supplied path segments so they cannot walk the CoinGecko path', async () => {
    repository.getShortTermChart.mockResolvedValue(null);
    http.get.mockResolvedValue({ data: { prices: [], market_caps: [], total_volumes: [] } });

    await service.getMarketChart({ coinId: 'sol/../x?y', days: 7, currency: 'usd' }, locals);

    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.coingecko.com/api/v3/coins/sol%2F..%2Fx%3Fy/market_chart'
    );
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
        headers: {},
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
      headers: {},
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
        id: 'bonk',
        symbol: 'jup',
        name: 'Bonk',
        image: { large: 'https://img/jup-large.png' },
        description: { en: 'DEX aggregator on Solana.' },
        links: { homepage: ['https://bonkcoin.com'], twitter_screen_name: 'bonk_inu' },
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
    expect(result.id).toBe('bonk');
    expect(result.name).toBe('Bonk');
    expect(result.description).toBe('DEX aggregator on Solana.');
    expect(result.links).toEqual({
      homepage: 'https://bonkcoin.com',
      twitter: 'https://twitter.com/bonk_inu',
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
    const cached = { id: 'bonk', name: 'Bonk' };
    repository.getShortTermCoinInfo.mockResolvedValue(cached);

    const result = await service.getContractCoinInfo(
      { platform: 'solana', contractAddress: 'JUPmint' },
      {}
    );

    expect(http.get).not.toHaveBeenCalled();
    expect(result).toBe(cached);
  });

  it('getContractCoinInfo falls back to the long-term cache on fetch failure', async () => {
    const cached = { id: 'bonk', name: 'Bonk' };
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

  describe('Solana token data', () => {
    const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

    it('fetches and caches the Solana token list for 24h, refusing an empty list', async () => {
      repository.getSolanaTokenList.mockResolvedValue(null);
      http.get.mockResolvedValueOnce({
        data: { tokens: [{ address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6 }] },
      });

      const tokens = await service.getSolanaTokenList();

      expect(http.get).toHaveBeenCalledWith(
        'https://api.coingecko.com/api/v3/token_lists/solana/all.json',
        expect.objectContaining({ timeout: 10000 })
      );
      expect(tokens).toHaveLength(1);
      expect(repository.saveSolanaTokenList).toHaveBeenCalledWith(tokens, 24 * 60 * 60);

      http.get.mockResolvedValueOnce({ data: { tokens: [] } });
      await expect(service.getSolanaTokenList()).rejects.toThrow('came back empty');
    });

    it('maps Solana mints to coin ids from coins/list', async () => {
      repository.getSolanaCoinIds.mockResolvedValue(null);
      http.get.mockResolvedValueOnce({
        data: [
          { id: 'usd-coin', platforms: { ethereum: '0xa0b8', solana: USDC } },
          { id: 'bitcoin', platforms: {} },
        ],
      });

      const ids = await service.getSolanaCoinIds();

      expect(http.get).toHaveBeenCalledWith(
        'https://api.coingecko.com/api/v3/coins/list',
        expect.objectContaining({ params: { include_platform: true } })
      );
      expect(ids.get(USDC)).toBe('usd-coin');
      expect(repository.saveSolanaCoinIds).toHaveBeenCalledWith(
        { [USDC]: 'usd-coin' },
        24 * 60 * 60
      );

      http.get.mockResolvedValueOnce({ data: { status: { error_code: 429 } } });
      await expect(service.getSolanaCoinIds()).rejects.toThrow('unexpected shape');
      http.get.mockResolvedValueOnce({ data: [{ id: 'bitcoin', platforms: {} }] });
      await expect(service.getSolanaCoinIds()).rejects.toThrow('no Solana platform');
    });

    it('prices mints in chunks, leaves unlisted mints absent, and caches hits', async () => {
      const priceCache = require('../../../infrastructure/cache/price-cache');
      http.get.mockResolvedValue({
        data: { [USDC]: { usd: 1.0001, usd_24h_change: -0.01 } },
      });
      const many = Array.from(
        { length: service.MAX_ADDRESSES_PER_PRICE_CALL + 1 },
        (_, i) => `M${i}`
      );

      const prices = await service.getTokenPrices([USDC, BONK, ...many]);

      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.get.mock.calls[0][1].params).toEqual(
        expect.objectContaining({ vs_currencies: 'usd', include_24hr_change: true })
      );
      expect(prices.get(USDC)).toEqual({ usdPrice: 1.0001, priceChange24h: -0.01 });
      expect(prices.has(BONK)).toBe(false);
      expect(priceCache.setCachedQuote).toHaveBeenCalledWith(USDC, prices.get(USDC), {});
    });

    it('sends the API key header when configured', async () => {
      process.env.COINGECKO_API_KEY = 'CG-test';
      repository.getSolanaCoinIds.mockResolvedValue({});
      await service.getSolanaCoinIds();
      expect(repository.getSolanaCoinIds).toHaveBeenCalled();
      delete process.env.COINGECKO_API_KEY;
    });
  });
});
