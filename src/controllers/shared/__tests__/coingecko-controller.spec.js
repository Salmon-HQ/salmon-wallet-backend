'use strict';

jest.mock('../../../services/shared/coingecko-service', () => ({
  getMarketChart: jest.fn(),
  getContractMarketChart: jest.fn(),
  getCoinInfo: jest.fn(),
  getContractCoinInfo: jest.fn(),
  getExchangeRates: jest.fn(),
  SUPPORTED_FIAT_CURRENCIES: ['usd', 'eur'],
  MAX_DAYS_FREE_TIER: 365,
}));

const service = require('../../../services/shared/coingecko-service');
const controller = require('../coingecko-controller');

const buildRes = () => {
  const res = { locals: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.removeHeader = jest.fn();
  return res;
};

describe('coingecko-controller getContractMarketChart', () => {
  beforeEach(() => jest.clearAllMocks());

  it('responds 200 with the service data', async () => {
    const chart = { platform: 'solana', prices: [] };
    service.getContractMarketChart.mockResolvedValue(chart);
    const res = buildRes();

    await controller.getContractMarketChart(
      { params: { platform: 'solana', address: 'MintX' }, query: { days: '30' } },
      res
    );

    expect(service.getContractMarketChart).toHaveBeenCalledWith(
      { platform: 'solana', contractAddress: 'MintX', days: '30', currency: undefined },
      res.locals
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(chart);
  });

  it('maps an upstream 404 to the chart_not_found envelope', async () => {
    service.getContractMarketChart.mockRejectedValue({ response: { status: 404 } });
    const res = buildRes();

    await controller.getContractMarketChart(
      { params: { platform: 'solana', address: 'UnknownMint' }, query: {} },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      error: 'chart_not_found',
      error_description: expect.stringContaining('UnknownMint'),
    });
  });

  it('rethrows non-404 errors to the error middleware', async () => {
    const boom = new Error('upstream 500');
    service.getContractMarketChart.mockRejectedValue(boom);

    await expect(
      controller.getContractMarketChart(
        { params: { platform: 'solana', address: 'MintX' }, query: {} },
        buildRes()
      )
    ).rejects.toThrow('upstream 500');
  });
});

describe('coingecko-controller getContractCoinInfo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('responds 200 with the mapped coin info including the resolved id', async () => {
    const coinInfo = { id: 'bonk', name: 'Bonk', marketData: {} };
    service.getContractCoinInfo.mockResolvedValue(coinInfo);
    const res = buildRes();

    await controller.getContractCoinInfo(
      { params: { platform: 'solana', address: 'MintX' }, query: { currency: 'usd' } },
      res
    );

    expect(service.getContractCoinInfo).toHaveBeenCalledWith(
      { platform: 'solana', contractAddress: 'MintX', currency: 'usd' },
      res.locals
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(coinInfo);
    expect(res.send.mock.calls[0][0].id).toBe('bonk');
  });

  it('maps an upstream 404 to the info_not_found envelope', async () => {
    service.getContractCoinInfo.mockRejectedValue({ response: { status: 404 } });
    const res = buildRes();

    await controller.getContractCoinInfo(
      { params: { platform: 'solana', address: 'UnknownMint' }, query: {} },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      error: 'info_not_found',
      error_description: expect.stringContaining('UnknownMint'),
    });
  });

  it('rethrows non-404 errors to the error middleware', async () => {
    const boom = new Error('upstream 500');
    service.getContractCoinInfo.mockRejectedValue(boom);

    await expect(
      controller.getContractCoinInfo(
        { params: { platform: 'solana', address: 'MintX' }, query: {} },
        buildRes()
      )
    ).rejects.toThrow('upstream 500');
  });
});
describe('coingecko-controller cache headers on 404', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [
      'getContractMarketChart',
      'getContractMarketChart',
      { params: { platform: 'solana', address: 'MintX' }, query: {} },
    ],
    [
      'getContractCoinInfo',
      'getContractCoinInfo',
      { params: { platform: 'solana', address: 'MintX' }, query: {} },
    ],
  ])('%s drops Cache-Control so CloudFront cannot hold the 404', async (_l, handler, req) => {
    service[handler].mockRejectedValue({ response: { status: 404 } });
    const res = buildRes();

    await controller[handler](req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.removeHeader).toHaveBeenCalledWith('Cache-Control');
  });
});

describe('coingecko-controller parameter validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('normalises days so one cache entry serves 7, 07 and 7.0, and clamps to the free tier', async () => {
    service.getMarketChart.mockResolvedValue({});
    for (const days of ['7', '07', '7.0']) {
      await controller.getMarketChart(
        { params: { coinId: 'solana' }, query: { days } },
        buildRes()
      );
      expect(service.getMarketChart).toHaveBeenLastCalledWith(
        { coinId: 'solana', days: '7', currency: undefined },
        expect.anything()
      );
    }
    await controller.getMarketChart(
      { params: { coinId: 'solana' }, query: { days: '9999' } },
      buildRes()
    );
    expect(service.getMarketChart).toHaveBeenLastCalledWith(
      { coinId: 'solana', days: '365', currency: undefined },
      expect.anything()
    );
  });

  it.each([
    ['days', { params: { coinId: 'solana' }, query: { days: 'abc' } }],
    ['days', { params: { coinId: 'solana' }, query: { days: '0' } }],
    ['currency', { params: { coinId: 'solana' }, query: { currency: 'xx1' } }],
    ['coinId', { params: { coinId: 'Bad/Id' }, query: {} }],
  ])('answers 400 invalid_parameter for a bad %s without calling CoinGecko', async (_name, req) => {
    const res = buildRes();
    res.json = jest.fn().mockReturnValue(res);
    await controller.getMarketChart(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_parameter' }));
    expect(service.getMarketChart).not.toHaveBeenCalled();
  });

  it('lowercases a supported currency and refuses a bad contract address', async () => {
    service.getCoinInfo.mockResolvedValue({});
    await controller.getCoinInfo(
      { params: { coinId: 'solana' }, query: { currency: 'EUR' } },
      buildRes()
    );
    expect(service.getCoinInfo).toHaveBeenCalledWith(
      { coinId: 'solana', currency: 'eur' },
      expect.anything()
    );
    const res = buildRes();
    res.json = jest.fn().mockReturnValue(res);
    await controller.getContractCoinInfo(
      { params: { platform: 'solana', address: 'a/../b' }, query: {} },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(service.getContractCoinInfo).not.toHaveBeenCalled();
  });
});
