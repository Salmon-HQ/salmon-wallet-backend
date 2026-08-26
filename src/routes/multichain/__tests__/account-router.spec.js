'use strict';

const mockRouter = {
  get: jest.fn(),
};

jest.mock('express', () => ({
  Router: jest.fn(() => mockRouter),
}));
jest.mock('../../../middlewares/multinetwork', () =>
  jest.fn((options) => ({ type: 'multinetwork', options }))
);
jest.mock('../../../../packages/api-utils', () => ({
  safe: jest.fn((handler) => ({ type: 'safe', handler })),
}));
jest.mock('../../../../packages/middleware', () => ({
  cacheControl: jest.fn((value) => ({ type: 'cacheControl', value })),
}));
jest.mock('../../shared/network-route-path', () => ({
  networkPath: jest.fn(() => ':networkId'),
}));
jest.mock('../../../controllers/multichain/account-controller', () => ({
  showBalance: 'showBalance',
}));
jest.mock('../../../constants/blockchains', () => ({
  BITCOIN: 'bitcoin',
  SOLANA: 'solana',
}));

describe('multichain account-router', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRouter.get.mockClear();
  });

  it('exposes a multichain balance endpoint for bitcoin and solana', () => {
    require('../account-router');

    expect(mockRouter.get).toHaveBeenCalledWith(
      '/:networkId/account/:address/balance',
      { type: 'multinetwork', options: { blockchains: ['bitcoin', 'solana'] } },
      { type: 'cacheControl', value: 'no-cache' },
      { type: 'safe', handler: 'showBalance' }
    );
  });
});
