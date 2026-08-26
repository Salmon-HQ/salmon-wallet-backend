'use strict';

/**
 * solana-nft-repository now delegates DAS calls to the provider resolver
 * (`services/solana/providers`). The resolver routes DAS to Triton primary
 * with a rate-limited Helius fallback, same as tx enrichment; goes straight
 * to Helius when Triton is not configured for the env.
 *
 * The repository's responsibility shrinks to:
 *   - cache lookup + store on findByAddress
 *   - delegating findByOwner / findFromSourceWithMint to the provider
 *
 * These tests stub the provider directly — provider routing is covered by
 * providers.spec.js.
 */

jest.mock('../../helper', () => ({
  getCacheKeyFor: jest.fn(() => 'cache-key'),
  getFromCache: jest.fn(),
  storeInCache: jest.fn(),
}));

jest.mock('../../../services/solana/providers', () => ({
  getNftsByOwner: jest.fn(),
  getNftByMint: jest.fn(),
}));

const helper = require('../../helper');
const provider = require('../../../services/solana/providers');
const repository = require('../solana-nft-repository');

describe('solana-nft-repository', () => {
  const locals = {
    network: {
      id: 'solana-mainnet',
      environment: 'mainnet',
      config: {
        nodeUrl: 'https://rpc.test',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    helper.getFromCache.mockResolvedValue(null);
    helper.storeInCache.mockResolvedValue(undefined);
  });

  it('returns cached NFTs by mint without hitting the provider', async () => {
    const cached = { mint: { address: 'mint-1' } };
    helper.getFromCache.mockResolvedValue(cached);

    const result = await repository.findByAddress('mint-1', locals);

    expect(helper.getCacheKeyFor).toHaveBeenCalledWith(
      'solana-nfts',
      'mintAddress',
      'mint-1',
      locals
    );
    expect(result).toBe(cached);
    expect(provider.getNftByMint).not.toHaveBeenCalled();
    expect(helper.storeInCache).not.toHaveBeenCalled();
  });

  it('fetches via provider and stores the transformed NFT in cache on miss', async () => {
    const transformed = {
      mint: { address: 'mint-2' },
      owner: 'owner-2',
      name: 'Mint Two',
    };
    provider.getNftByMint.mockResolvedValue(transformed);

    const result = await repository.findByAddress('mint-2', locals);

    expect(provider.getNftByMint).toHaveBeenCalledWith('mint-2', locals);
    expect(result).toBe(transformed);
    expect(helper.storeInCache).toHaveBeenCalledWith('cache-key', transformed, 3600);
  });

  it('does not cache when the provider returns null', async () => {
    provider.getNftByMint.mockResolvedValue(null);

    const result = await repository.findByAddress('mint-3', locals);

    expect(result).toBeNull();
    expect(helper.storeInCache).not.toHaveBeenCalled();
  });

  it('forwards findByOwner to the provider with options + locals', async () => {
    const expected = {
      data: [{ mint: { address: 'mint-a' } }],
      pagination: { total: 1, limit: 1, offset: 0, hasMore: false, nextOffset: null },
    };
    provider.getNftsByOwner.mockResolvedValue(expected);

    const result = await repository.findByOwner('owner-1', { limit: 1 }, locals);

    expect(provider.getNftsByOwner).toHaveBeenCalledWith('owner-1', { limit: 1 }, locals);
    expect(result).toBe(expected);
  });

  it('forwards findFromSourceWithMint to the provider', async () => {
    const expected = { mint: { address: 'mint-x' } };
    provider.getNftByMint.mockResolvedValue(expected);

    const result = await repository.findFromSourceWithMint('mint-x', locals);

    expect(provider.getNftByMint).toHaveBeenCalledWith('mint-x', locals);
    expect(result).toBe(expected);
  });
});
