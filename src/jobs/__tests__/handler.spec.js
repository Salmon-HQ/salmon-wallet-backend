'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

jest.mock('../../repositories/shared/coingecko-repository', () => ({
  getTokensList: jest.fn(),
  saveTokensList: jest.fn(),
  getTokensPrices: jest.fn(),
  saveTokensPrices: jest.fn(),
}));

jest.mock('../../repositories/data-source', () => ({
  redis: {
    quit: jest.fn().mockResolvedValue(undefined),
  },
}));

const http = require('axios');
const repository = require('../../repositories/shared/coingecko-repository');
const handler = require('../handler');

describe('jobs/handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'jest';
  });

  afterEach(() => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.COINGECKO_API_KEY;
    jest.useRealTimers();
  });

  it('listTokensJob sends the CoinGecko API key', async () => {
    process.env.COINGECKO_API_KEY = 'test-key';
    http.get.mockResolvedValue({ data: [] });
    repository.getTokensList.mockResolvedValue(null);

    await handler.listTokensJob({ platform: 'bitcoin' });

    expect(http.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/v3/coins/list'),
      expect.objectContaining({ headers: { 'x-cg-demo-api-key': 'test-key' } })
    );
  });

  it('refreshPricesJob sends the CoinGecko API key', async () => {
    process.env.COINGECKO_API_KEY = 'test-key';
    http.get.mockResolvedValue({ data: { bitcoin: { usd: 1 } } });
    repository.getTokensList.mockResolvedValue([{ id: 'bitcoin', last_updated: null }]);
    repository.getTokensPrices.mockResolvedValue([]);

    await handler.refreshPricesJob({ platform: 'bitcoin' });

    expect(http.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/v3/simple/price'),
      expect.objectContaining({ headers: { 'x-cg-demo-api-key': 'test-key' } })
    );
  });

  it('listTokensJob filters tokens by platform and preserves existing timestamps', async () => {
    http.get.mockResolvedValue({
      data: [
        { id: 'solana', symbol: 'sol', platforms: { solana: 'So111' } },
        { id: 'bonk', symbol: 'bonk', platforms: { solana: 'DezX' } },
        { id: 'ethereum', symbol: 'eth', platforms: { ethereum: '0x1' } },
      ],
    });
    repository.getTokensList.mockResolvedValue([
      { id: 'bonk', last_updated: '2024-01-01T00:00:00.000Z' },
    ]);

    const response = await handler.listTokensJob({ platform: 'solana' });

    expect(repository.saveTokensList).toHaveBeenCalledWith(
      [
        {
          id: 'solana',
          symbol: 'sol',
          platforms: { solana: 'So111' },
          last_updated: null,
        },
        {
          id: 'bonk',
          symbol: 'bonk',
          platforms: { solana: 'DezX' },
          last_updated: '2024-01-01T00:00:00.000Z',
        },
      ],
      'solana'
    );
    expect(response).toEqual({
      statusCode: 200,
      body: JSON.stringify({ message: 'Token list job completed!' }),
    });
  });

  it('refreshPricesJob updates only outdated token timestamps before saving', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-22T12:00:00.000Z'));

    repository.getTokensList.mockResolvedValue([
      { id: 'btc-token', symbol: 'btc', last_updated: '2026-04-20T00:00:00.000Z' },
      { id: 'ordinals', symbol: 'ordi', last_updated: null },
    ]);
    repository.getTokensPrices.mockResolvedValue([
      { id: 'btc-token', price: { usd: 70000 }, last_updated: '2026-04-20T00:00:00.000Z' },
    ]);
    http.get.mockResolvedValue({
      data: {
        ordinals: { usd: 12.5, usd_24h_change: 3.1 },
      },
    });

    const response = await handler.refreshPricesJob({ platform: 'bitcoin' });

    expect(repository.saveTokensPrices).toHaveBeenCalledWith(
      [
        { id: 'btc-token', price: { usd: 70000 }, last_updated: '2026-04-20T00:00:00.000Z' },
        {
          id: 'ordinals',
          symbol: 'ordi',
          last_updated: '2026-04-22T12:00:00.000Z',
          price: { usd: 12.5, usd_24h_change: 3.1 },
        },
      ],
      'bitcoin'
    );
    expect(repository.saveTokensList).toHaveBeenCalledWith(
      [
        { id: 'btc-token', symbol: 'btc', last_updated: '2026-04-20T00:00:00.000Z' },
        { id: 'ordinals', symbol: 'ordi', last_updated: '2026-04-22T12:00:00.000Z' },
      ],
      'bitcoin'
    );
    expect(response).toEqual({
      statusCode: 200,
      body: JSON.stringify({ message: 'Prices refresh job completed!' }),
    });
  });
});
