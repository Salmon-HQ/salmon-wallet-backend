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
jest.mock('../../../../packages/middleware', () => ({
  cacheControl: jest.fn((value) => ({ type: 'cacheControl', value })),
}));
jest.mock('../../../controllers/solana/solana-ft-controller', () => ({
  verified: 'verified',
  search: 'search',
  build: 'build',
  swapNetworkOnly: 'swapNetworkOnly',
}));
jest.mock('../../../middlewares/powerup-gate', () => jest.fn((capability) => `gate:${capability}`));

describe('solana-ft-router', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRouter.get.mockClear();
    mockRouter.post.mockClear();
  });

  it('registers the catalog endpoints', () => {
    require('../solana-ft-router');

    const paths = mockRouter.get.mock.calls.map(([path]) => path);

    expect(paths).toEqual(expect.arrayContaining(['/verified', '/search']));
  });

  it('registers the swap build as a GET behind the mainnet check and the gate, and no execute route (signing boundary)', () => {
    require('../solana-ft-router');

    expect(mockRouter.get.mock.calls.map(([path]) => path)).toEqual([
      '/verified',
      '/search',
      '/swap/build',
    ]);
    expect(mockRouter.get).toHaveBeenCalledWith('/swap/build', 'swapNetworkOnly', 'gate:swap', {
      type: 'safe',
      handler: 'build',
    });
    expect(mockRouter.post).not.toHaveBeenCalled();
  });
});
