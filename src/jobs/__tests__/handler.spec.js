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
    jest.useRealTimers();
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
