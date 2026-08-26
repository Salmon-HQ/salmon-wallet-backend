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
jest.mock('../../../controllers/solana/solana-nft-controller', () => ({
  list: 'list',
  burnTransaction: 'burnTransaction',
  transferTransaction: 'transferTransaction',
}));

describe('solana-nft-router', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRouter.get.mockClear();
    mockRouter.post.mockClear();
  });

  it('keeps NFT list, burn and transfer routes registered', () => {
    require('../solana-nft-router');

    expect(mockRouter.get).toHaveBeenCalledWith(
      '/',
      { type: 'cacheControl', value: 'max-age=60' },
      { type: 'safe', handler: 'list' }
    );
    expect(mockRouter.post).toHaveBeenCalledWith('/:mintAddress', {
      type: 'safe',
      handler: 'burnTransaction',
    });
    expect(mockRouter.post).toHaveBeenCalledWith('/:mintAddress/transfer', {
      type: 'safe',
      handler: 'transferTransaction',
    });
    expect(mockRouter.get).toHaveBeenCalledTimes(1);
    expect(mockRouter.post).toHaveBeenCalledTimes(2);
  });
});
