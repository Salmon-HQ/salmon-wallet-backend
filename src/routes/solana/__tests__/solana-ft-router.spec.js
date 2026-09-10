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
  build: 'build',
  verified: 'verified',
  search: 'search',
}));

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

  it('registers the swap build as a GET and no execute route (signing boundary)', () => {
    require('../solana-ft-router');

    expect(mockRouter.get).toHaveBeenCalledWith('/swap/build', { type: 'safe', handler: 'build' });
    expect(mockRouter.get).not.toHaveBeenCalledWith('/swap/order', expect.anything());
    expect(mockRouter.post).not.toHaveBeenCalled();
  });
});
