'use strict';

const mockRouter = {
  get: jest.fn(),
  post: jest.fn(),
};

jest.mock('express', () => ({
  Router: jest.fn(() => mockRouter),
}));
jest.mock('../../../../packages/api-utils', () => ({
  safe: jest.fn((handler) => ({ type: 'safe', handler })),
}));
jest.mock('../../../controllers/shared/bridge-controller', () => ({
  listAvailable: 'listAvailable',
  getEstimate: 'getEstimate',
  getMinimalAmountIn: 'getMinimalAmountIn',
  createExchange: 'createExchange',
  createExchangeFromBody: 'createExchangeFromBody',
  getTransaction: 'getTransaction',
}));

describe('bridge-router', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRouter.get.mockClear();
    mockRouter.post.mockClear();
  });

  it('registers POST /exchange so exchange creation is not retried as a GET', () => {
    require('../bridge-router');

    expect(mockRouter.post).toHaveBeenCalledWith('/exchange', {
      type: 'safe',
      handler: 'createExchangeFromBody',
    });
  });

  it('keeps GET /exchange registered for already-shipped clients', () => {
    require('../bridge-router');

    expect(mockRouter.get).toHaveBeenCalledWith('/exchange', {
      type: 'safe',
      handler: 'createExchange',
    });
  });
});
