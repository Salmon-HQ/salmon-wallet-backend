'use strict';

/**
 * HeliusProvider DAS-failure fallback unit tests.
 *
 * Focus: the provider must degrade gracefully when the Helius DAS RPC
 * fails — `getNftsByOwner` still returns the paginated shape (Token-2022
 * NFTs only) and `getNftByMint` returns null instead of throwing. Axios,
 * the rate limiter, and the das-shared helpers are mocked so nothing
 * touches the network.
 */

jest.mock('axios');
jest.mock('@solana/web3.js', () => ({ Connection: jest.fn() }));
jest.mock('../../../../infrastructure/rate-limiting/helius-rate-limiter', () => ({
  withRetry: jest.fn(async (fn) => fn()),
  rateLimiter: { waitAndConsume: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../das-shared', () => ({
  transformDasAsset: jest.fn((asset, owner) => ({ mint: asset.id, owner })),
  fetchToken2022NftsByOwner: jest.fn(),
  paginateNfts: jest.fn((nfts, limit, offset) => ({
    data: nfts.slice(offset, offset + limit),
    pagination: { total: nfts.length, limit, offset, hasMore: false, nextOffset: null },
  })),
  getPagination: jest.fn(() => ({ limit: 50, offset: 0 })),
}));

const axios = require('axios');
const { transformDasAsset, fetchToken2022NftsByOwner } = require('../das-shared');
const provider = require('../helius-provider');

const locals = { network: { config: { nodeUrl: 'http://helius-node' } } };

let consoleErrorSpy;

beforeEach(() => {
  jest.clearAllMocks();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('getNftsByOwner()', () => {
  test('propagates a DAS failure instead of reporting a short list', async () => {
    // Arrange
    axios.post.mockRejectedValue(new Error('DAS down'));
    fetchToken2022NftsByOwner.mockResolvedValue([{ mint: 't22-mint' }]);

    // Assert: swallowing this answered 200 with whatever the other leg found,
    // which the wallet renders as the user's complete collection.
    await expect(provider.getNftsByOwner('owner-pubkey', {}, locals)).rejects.toThrow('DAS down');
  });
});

describe('getNftByMint()', () => {
  test('propagates a DAS failure instead of claiming the asset is missing', async () => {
    // Arrange
    axios.post.mockRejectedValue(new Error('DAS down'));

    // Assert: `null` means 404 nft_not_found downstream, i.e. "your NFT does
    // not exist" — the wrong thing to tell an owner when the indexer is down.
    await expect(provider.getNftByMint('mint-address', locals)).rejects.toThrow('DAS down');
  });

  test('returns null when the DAS response has no asset', async () => {
    // Arrange
    axios.post.mockResolvedValue({ data: { result: undefined } });

    // Act
    const result = await provider.getNftByMint('mint-address', locals);

    // Assert
    expect(result).toBeNull();
    expect(transformDasAsset).not.toHaveBeenCalled();
  });
});
