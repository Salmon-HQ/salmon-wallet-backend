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
  order: 'order',
  execute: 'execute',
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

  it('registers no swap endpoint', () => {
    require('../solana-ft-router');

    const paths = [...mockRouter.get.mock.calls, ...mockRouter.post.mock.calls].map(
      ([path]) => path
    );

    expect(paths.some((path) => path.startsWith('/swap'))).toBe(false);
  });
});
