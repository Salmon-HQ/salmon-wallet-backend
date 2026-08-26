'use strict';

const mockRouter = {
  use: jest.fn(),
};

jest.mock('express', () => ({
  Router: jest.fn(() => mockRouter),
}));
jest.mock('../solana-ft-router', () => 'solana-ft-router');
jest.mock('../solana-account-router', () => 'solana-account-router');
jest.mock('../solana-nft-router', () => 'solana-nft-router');

describe('solana index router', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRouter.use.mockClear();
  });

  it('mounts only active Solana resource routers', () => {
    require('..');

    expect(mockRouter.use).toHaveBeenCalledWith('/ft', 'solana-ft-router');
    expect(mockRouter.use).toHaveBeenCalledWith('/account', 'solana-account-router');
    expect(mockRouter.use).toHaveBeenCalledWith('/nft', 'solana-nft-router');
    expect(mockRouter.use).not.toHaveBeenCalledWith('/bridge', expect.anything());
  });
});
