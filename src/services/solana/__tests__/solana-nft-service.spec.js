'use strict';

const repository = require('../../../repositories/solana/solana-nft-repository');
const burnService = require('../burn-service');
const addressService = require('../solana-address-service');
const service = require('../solana-nft-service');
const { SolanaNftNotFoundError } = require('../solana-nft-burn-errors');

jest.mock('../../../repositories/solana/solana-nft-repository');
jest.mock('../burn-service', () => ({
  burnMasterEditionTransaction: jest.fn(),
  burnEditionsTransaction: jest.fn(),
  burnProgrammableNftTransaction: jest.fn(),
  burnCompressedNftTransaction: jest.fn(),
}));
jest.mock('../solana-address-service');
jest.mock('../nft-metadata-hydrator', () => ({
  hydrateMany: jest.fn(async (nfts) => nfts),
}));

describe('Solana NFT Service - burn transaction', () => {
  const locals = {
    network: {
      config: {
        nodeUrl: 'http://localhost:8899',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('throws not found when the NFT does not exist', async () => {
    repository.findFromSourceWithMint.mockResolvedValue(null);

    await expect(
      service.createBurnTransaction('missing-mint', 'owner-address', locals)
    ).rejects.toBeInstanceOf(SolanaNftNotFoundError);
  });

  test('uses compressed burn for compressed NFTs', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'V1_NFT',
      compressed: true,
      edition: { isOriginal: true },
    });
    burnService.burnCompressedNftTransaction.mockResolvedValue({ transaction: 'compressed' });

    const result = await service.createBurnTransaction('compressed-mint', 'owner-address', locals);

    expect(burnService.burnCompressedNftTransaction).toHaveBeenCalledWith(
      'compressed-mint',
      'owner-address',
      locals
    );
    expect(burnService.burnMasterEditionTransaction).not.toHaveBeenCalled();
    expect(burnService.burnEditionsTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({ transaction: 'compressed' });
  });

  test('uses programmable burn for programmable NFTs', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'ProgrammableNonFungible',
      compressed: false,
      edition: { isOriginal: true },
    });
    burnService.burnProgrammableNftTransaction.mockResolvedValue({ transaction: 'pnft' });

    const result = await service.createBurnTransaction('pnft-mint', 'owner-address', locals);

    expect(burnService.burnProgrammableNftTransaction).toHaveBeenCalledWith(
      'pnft-mint',
      'owner-address',
      locals
    );
    expect(result).toEqual({ transaction: 'pnft' });
  });

  test('uses master edition burn for original editions', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'V1_NFT',
      compressed: false,
      edition: { isOriginal: true },
    });
    burnService.burnMasterEditionTransaction.mockResolvedValue({ transaction: 'master' });

    const result = await service.createBurnTransaction('master-mint', 'owner-address', locals);

    expect(burnService.burnMasterEditionTransaction).toHaveBeenCalledWith(
      'master-mint',
      'owner-address',
      locals
    );
    expect(result).toEqual({ transaction: 'master' });
  });

  test('uses edition burn for printed editions', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'V1_NFT',
      compressed: false,
      edition: { isOriginal: false },
    });
    addressService.findAssociatedTokenAddress.mockResolvedValue('ata-address');
    burnService.burnEditionsTransaction.mockResolvedValue({ transaction: 'edition' });

    const result = await service.createBurnTransaction('edition-mint', 'owner-address', locals);

    expect(addressService.findAssociatedTokenAddress).toHaveBeenCalledWith(
      'owner-address',
      'edition-mint'
    );
    expect(burnService.burnEditionsTransaction).toHaveBeenCalledWith(
      'edition-mint',
      'ata-address',
      'owner-address',
      locals
    );
    expect(result).toEqual({ transaction: 'edition' });
  });
});

describe('Solana NFT Service - list', () => {
  it('leaves the page name counts on locals for the resource spam scoring', async () => {
    const page = {
      data: [{ name: 'Limited Drop' }, { name: 'Limited Drop' }, { name: 'Limited Drop #3' }],
      pagination: { total: 3 },
    };
    repository.findByOwner.mockResolvedValue(page);
    const locals = {};

    const result = await service.list({ publicKey: 'owner' }, locals);

    expect(result.data).toEqual(page.data);
    expect(locals.nftNameCounts).toEqual({ 'limited drop': 3 });
  });

  it('passes an empty page through untouched', async () => {
    repository.findByOwner.mockResolvedValue(null);
    const locals = {};

    expect(await service.list({ publicKey: 'owner' }, locals)).toBeNull();
    expect(locals.nftNameCounts).toBeUndefined();
  });
});

describe('Solana NFT Service - filterSpam', () => {
  const service = require('../solana-nft-service');

  const clean = { mint: 'a', spamScore: 0, spamReasons: [] };
  const scored = { mint: 'b', spamScore: 3, spamReasons: ['no_collection'] };
  const blacklisted = { mint: 'c', spamScore: 0, spamReasons: [], blacklisted: true };

  it('drops null entries and spam NFTs by default, counting what it hid', () => {
    expect(service.filterSpam([clean, null, scored, blacklisted])).toEqual({
      data: [clean],
      hidden: { spam: 2, fungible: 1 },
    });
  });

  it('keeps spam NFTs (but not nulls) when includeSpam is true', () => {
    expect(service.filterSpam([clean, null, scored, blacklisted], true)).toEqual({
      data: [clean, scored, blacklisted],
      hidden: { spam: 0, fungible: 1 },
    });
  });
});
