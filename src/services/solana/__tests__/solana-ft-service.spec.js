'use strict';

jest.mock('../../../repositories/solana/solana-ft-repository', () => ({
  getVerifiedTokens: jest.fn(),
  saveVerifiedTokens: jest.fn(),
}));
jest.mock('../token-catalog-service', () => ({
  getVerified: jest.fn(),
  byMints: jest.fn(),
  search: jest.fn(),
}));
jest.mock('../token-metadata-service', () => ({
  getByMints: jest.fn(),
  MAX_IDS_PER_BATCH: 1000,
}));

const repository = require('../../../repositories/solana/solana-ft-repository');
const catalog = require('../token-catalog-service');
const metadata = require('../token-metadata-service');
const service = require('../solana-ft-service');

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BERN = 'CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo';
const NFT = 'nft-mint';
const locals = { network: { environment: 'mainnet' } };

const listedUsdc = {
  id: USDC,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  icon: 'cg.png',
  tags: ['verified'],
  coingeckoId: 'usd-coin',
};
const onChainUsdc = {
  id: USDC,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  icon: 'chain.png',
  tokenProgram: 'spl-token',
  swappable: true,
};
const onChainBern = {
  id: BERN,
  symbol: 'BERN',
  name: 'Bern',
  decimals: 5,
  icon: null,
  tokenProgram: 'token-2022',
  swappable: false,
};
const onChainNft = {
  id: NFT,
  symbol: 'NFT',
  name: 'x',
  decimals: 0,
  icon: null,
  tokenProgram: 'spl-token',
  swappable: true,
};

describe('Solana FT Service - token list cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.clearListCache();
  });

  test('serves the mainnet list from the catalog once per process', async () => {
    catalog.getVerified.mockResolvedValue([listedUsdc]);

    const first = await service.list(locals);
    const second = await service.list(locals);

    expect(catalog.getVerified).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first[0].id).toBe(USDC);
  });
});

describe('Solana FT Service - catalog + on-chain metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.getVerifiedTokens.mockResolvedValue(null);
  });

  test('exposes the metadata batch limit for controller validation', () => {
    expect(service.MAX_MINTS_PER_QUERY).toBe(1000);
  });

  test('getByMints merges listed fields over on-chain metadata, keeps unlisted mints, drops NFT-like assets', async () => {
    metadata.getByMints.mockResolvedValue(
      new Map([
        [USDC, onChainUsdc],
        [BERN, onChainBern],
        [NFT, onChainNft],
      ])
    );
    catalog.byMints.mockResolvedValue(new Map([[USDC, listedUsdc]]));

    const result = await service.getByMints([USDC, BERN, NFT, USDC], locals);

    expect(metadata.getByMints).toHaveBeenCalledWith([USDC, BERN, NFT], locals);
    expect(result).toEqual([
      {
        ...onChainUsdc,
        ...listedUsdc,
        icon: 'cg.png',
        tokenProgram: 'spl-token',
        swappable: true,
      },
      { ...onChainBern, tags: [], coingeckoId: null, swappable: false },
    ]);
  });

  test('getVerified decorates the catalog with on-chain program/swappability and caches it', async () => {
    catalog.getVerified.mockResolvedValue([listedUsdc]);
    metadata.getByMints.mockResolvedValue(new Map([[USDC, onChainUsdc]]));

    const result = await service.getVerified(locals);

    expect(result).toEqual([{ ...onChainUsdc, ...listedUsdc, icon: 'cg.png', swappable: true }]);
    expect(repository.saveVerifiedTokens).toHaveBeenCalledWith(result, locals);
  });

  test('getVerified serves the repository cache and treats an empty cache as a miss', async () => {
    repository.getVerifiedTokens.mockResolvedValue([listedUsdc]);
    expect(await service.getVerified(locals)).toEqual([listedUsdc]);
    expect(catalog.getVerified).not.toHaveBeenCalled();

    repository.getVerifiedTokens.mockResolvedValue([]);
    catalog.getVerified.mockResolvedValue([listedUsdc]);
    metadata.getByMints.mockResolvedValue(new Map());
    await service.getVerified(locals);
    expect(catalog.getVerified).toHaveBeenCalledTimes(1);
  });

  test('getVerified propagates a catalog failure instead of answering an empty list', async () => {
    catalog.getVerified.mockRejectedValue(new Error('coingecko down'));

    await expect(service.getVerified(locals)).rejects.toThrow('coingecko down');
    expect(repository.saveVerifiedTokens).not.toHaveBeenCalled();
  });

  test('search returns catalog matches decorated on-chain', async () => {
    catalog.search.mockResolvedValue([listedUsdc]);
    metadata.getByMints.mockResolvedValue(new Map([[USDC, onChainUsdc]]));

    const result = await service.search('usdc', locals);

    expect(catalog.search).toHaveBeenCalledWith('usdc');
    expect(result[0]).toMatchObject({ id: USDC, tags: ['verified'], swappable: true });
  });

  test('search resolves an unlisted mint address on-chain, unverified', async () => {
    catalog.search.mockResolvedValue([]);
    metadata.getByMints.mockResolvedValue(new Map([[BERN, onChainBern]]));

    const result = await service.search(BERN, locals);

    expect(metadata.getByMints).toHaveBeenCalledWith([BERN], locals);
    expect(result).toEqual([{ ...onChainBern, tags: [], coingeckoId: null }]);
  });

  test('search returns nothing for an unlisted non-address query without touching the chain', async () => {
    catalog.search.mockResolvedValue([]);

    expect(await service.search('definitely not a token', locals)).toEqual([]);
    expect(metadata.getByMints).not.toHaveBeenCalled();
  });
});
