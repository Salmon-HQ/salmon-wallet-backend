'use strict';

const mockRouter = {
  get: jest.fn(),
};

jest.mock('express', () => ({
  Router: jest.fn(() => mockRouter),
}));
jest.mock('../../../../packages/api-utils', () => ({
  safe: jest.fn((handler) => ({ type: 'safe', handler })),
}));
jest.mock('../../../../packages/middleware', () => ({
  cacheControl: jest.fn((value) => ({ type: 'cacheControl', value })),
}));
jest.mock('../../../controllers/shared/coingecko-controller', () => ({
  getMarketChart: 'getMarketChart',
  getCoinInfo: 'getCoinInfo',
  getExchangeRates: 'getExchangeRates',
}));

describe('coingecko-router', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRouter.get.mockClear();
  });

  it('registers the exchange rates endpoint used by the frontend currency service', () => {
    require('../coingecko-router');

    expect(mockRouter.get).toHaveBeenCalledWith(
      '/exchange-rates',
      { type: 'cacheControl', value: 'max-age=900' },
      { type: 'safe', handler: 'getExchangeRates' }
    );
  });
});
