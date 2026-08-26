'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

jest.mock('../../../repositories/solana/solana-ft-repository', () => ({
  getVerifiedTokens: jest.fn(),
  saveVerifiedTokens: jest.fn(),
}));

jest.mock('../jupiter-token-service', () => ({
  getTokensByMints: jest.fn(),
  getVerifiedTokens: jest.fn(),
  searchTokensByQuery: jest.fn(),
  MAX_MINTS_PER_QUERY: 100,
}));

jest.mock('../cdn-token-list-service', () => ({
  getVerifiedTokens: jest.fn(),
}));

const http = require('axios');
const repository = require('../../../repositories/solana/solana-ft-repository');
const jupiterTokenService = require('../jupiter-token-service');
const cdnTokenListService = require('../cdn-token-list-service');
const service = require('../solana-ft-service');

describe('Solana FT Service - token list cache', () => {
  const locals = {
    network: {
      environment: 'mainnet',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service.clearListCache();
  });

  test('should cache token lists by environment', async () => {
    http.get.mockResolvedValue({
      data: [
        { address: 'token-1', name: 'USD Coin' },
        { address: 'token-2', name: 'Wrapped SOL' },
      ],
    });

    const first = await service.list(locals);
    const second = await service.list(locals);

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  test('should deduplicate concurrent token list loads', async () => {
    let resolveRequest;
    http.get.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const first = service.list(locals);
    const second = service.list(locals);

    expect(http.get).toHaveBeenCalledTimes(1);

    resolveRequest({
      data: [{ address: 'token-1', name: 'USD Coin' }],
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ address: 'token-1', name: 'USD Coin' }],
      [{ address: 'token-1', name: 'USD Coin' }],
    ]);
  });
});

describe('Solana FT Service - Jupiter token discovery', () => {
  const locals = {
    network: {
      environment: 'mainnet',
    },
  };
  const fungible = { address: 'token-1', symbol: 'USDC', decimals: 6 };
  const nftLike = { address: 'nft-1', symbol: 'NFT', decimals: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('exposes the Jupiter mint query limit for controller validation', () => {
    expect(service.MAX_MINTS_PER_QUERY).toBe(100);
  });

  test('gets tokens by mint and filters out NFT-like zero-decimal assets', async () => {
    jupiterTokenService.getTokensByMints.mockResolvedValue([fungible, nftLike]);

    const result = await service.getByMints(['token-1', 'nft-1'], locals);

    expect(jupiterTokenService.getTokensByMints).toHaveBeenCalledWith(['token-1', 'nft-1'], locals);
    expect(result).toEqual([fungible]);
  });

  test('returns cached verified tokens when available', async () => {
    repository.getVerifiedTokens.mockResolvedValue([fungible, nftLike]);

    const result = await service.getVerified(locals);

    expect(result).toEqual([fungible]);
    expect(jupiterTokenService.getVerifiedTokens).not.toHaveBeenCalled();
    expect(repository.saveVerifiedTokens).not.toHaveBeenCalled();
  });

  test('loads and caches verified tokens on cache miss', async () => {
    repository.getVerifiedTokens.mockResolvedValue(null);
    jupiterTokenService.getVerifiedTokens.mockResolvedValue([fungible, nftLike]);

    const result = await service.getVerified(locals);

    expect(result).toEqual([fungible]);
    expect(repository.saveVerifiedTokens).toHaveBeenCalledWith([fungible, nftLike], locals);
    expect(cdnTokenListService.getVerifiedTokens).not.toHaveBeenCalled();
  });

  test('falls back to the Solana Labs CDN when Jupiter throws on cache miss', async () => {
    repository.getVerifiedTokens.mockResolvedValue(null);
    jupiterTokenService.getVerifiedTokens.mockRejectedValue(new Error('jupiter 503'));
    const cdnTokens = [
      {
        id: 'cdn-1',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        icon: null,
        tags: [],
        coingeckoId: 'usd-coin',
      },
      {
        id: 'cdn-nft',
        symbol: 'NFT',
        name: 'NFT Like',
        decimals: 0,
        icon: null,
        tags: [],
        coingeckoId: null,
      },
    ];
    cdnTokenListService.getVerifiedTokens.mockResolvedValue(cdnTokens);

    const result = await service.getVerified(locals);

    expect(cdnTokenListService.getVerifiedTokens).toHaveBeenCalledTimes(1);
    expect(repository.saveVerifiedTokens).toHaveBeenCalledWith(cdnTokens, locals);
    expect(result).toEqual([cdnTokens[0]]);
  });

  test('rethrows when both Jupiter and CDN fail', async () => {
    repository.getVerifiedTokens.mockResolvedValue(null);
    jupiterTokenService.getVerifiedTokens.mockRejectedValue(new Error('jupiter 503'));
    cdnTokenListService.getVerifiedTokens.mockRejectedValue(new Error('cdn timeout'));

    await expect(service.getVerified(locals)).rejects.toThrow('cdn timeout');
    expect(repository.saveVerifiedTokens).not.toHaveBeenCalled();
  });

  test('searches tokens and filters out NFT-like zero-decimal assets', async () => {
    jupiterTokenService.searchTokensByQuery.mockResolvedValue([fungible, nftLike]);

    const result = await service.search('usdc', locals);

    expect(jupiterTokenService.searchTokensByQuery).toHaveBeenCalledWith('usdc', locals);
    expect(result).toEqual([fungible]);
  });

  describe('empty verified catalog', () => {
    it('does not cache an empty token list', async () => {
      repository.getVerifiedTokens.mockResolvedValue(null);
      jupiterTokenService.getVerifiedTokens.mockResolvedValue([]);

      await service.getVerified(locals);

      // Persisting it would serve an empty swap catalog for the whole TTL.
      expect(repository.saveVerifiedTokens).not.toHaveBeenCalled();
    });

    it('treats an empty cached list as a miss', async () => {
      repository.getVerifiedTokens.mockResolvedValue([]);
      jupiterTokenService.getVerifiedTokens.mockResolvedValue([{ address: 'mint-1', decimals: 6 }]);

      const result = await service.getVerified(locals);

      expect(jupiterTokenService.getVerifiedTokens).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });
});
