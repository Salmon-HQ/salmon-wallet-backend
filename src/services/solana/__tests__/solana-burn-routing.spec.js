'use strict';

const repository = require('../../../repositories/solana/solana-nft-repository');
const burnService = require('../burn-service');
const addressService = require('../solana-address-service');
const service = require('../solana-nft-service');
const {
  SolanaNftNotFoundError,
  UnsupportedSolanaNftBurnError,
} = require('../solana-nft-burn-errors');

jest.mock('../../../repositories/solana/solana-nft-repository');
jest.mock('../burn-service', () => ({
  burnMasterEditionTransaction: jest.fn(),
  burnEditionsTransaction: jest.fn(),
  burnProgrammableNftTransaction: jest.fn(),
  burnCompressedNftTransaction: jest.fn(),
}));
jest.mock('../solana-address-service');

describe('solana burn routing', () => {
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

  test('routes compressed NFTs to the compressed burn service', async () => {
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
    expect(result).toEqual({ transaction: 'compressed' });
  });

  test('routes programmable NFTs to burnV1 handling', async () => {
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

  test('routes printed editions to SPL burn + close', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'V1_NFT_Edition',
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

  test('routes original legacy NFTs to master edition burn', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'NonFungible',
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

  test('throws for unsupported token standards', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'SemiFungible',
      compressed: false,
      edition: null,
    });

    await expect(
      service.createBurnTransaction('unsupported-mint', 'owner-address', locals)
    ).rejects.toBeInstanceOf(UnsupportedSolanaNftBurnError);
  });
});

describe('fungible-token guard', () => {
  const locals = {
    network: { config: { nodeUrl: 'http://localhost:8899' } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // USDC as DAS actually returns it: interface 'Custom', a non-zero
  // edition_nonce (so `edition.isOriginal` is false) and decimals 6. Before the
  // guard this routed to the print-edition burn, which builds a raw SPL
  // Burn + closeAccount — i.e. the endpoint handed back a transaction that
  // destroys the caller's fungible balance.
  const usdcLikeAsset = {
    tokenStandard: 'Custom',
    compressed: false,
    edition: { isOriginal: false },
    decimals: 6,
  };

  test('refuses to build a burn transaction for a fungible mint', async () => {
    repository.findFromSourceWithMint.mockResolvedValue(usdcLikeAsset);

    await expect(
      service.createBurnTransaction('usdc-mint', 'owner-address', locals)
    ).rejects.toBeInstanceOf(UnsupportedSolanaNftBurnError);

    expect(burnService.burnEditionsTransaction).not.toHaveBeenCalled();
    expect(burnService.burnMasterEditionTransaction).not.toHaveBeenCalled();
    expect(burnService.burnProgrammableNftTransaction).not.toHaveBeenCalled();
    expect(burnService.burnCompressedNftTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['FungibleToken', { tokenStandard: 'FungibleToken', decimals: 0 }],
    ['FungibleAsset', { tokenStandard: 'FungibleAsset', decimals: 0 }],
  ])('refuses to burn a %s even when decimals are 0', async (_label, overrides) => {
    repository.findFromSourceWithMint.mockResolvedValue({
      compressed: false,
      edition: { isOriginal: false },
      ...overrides,
    });

    await expect(
      service.createBurnTransaction('fungible-mint', 'owner-address', locals)
    ).rejects.toBeInstanceOf(UnsupportedSolanaNftBurnError);
    expect(burnService.burnEditionsTransaction).not.toHaveBeenCalled();
  });

  test('still burns a real print edition (decimals 0, non-fungible interface)', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'V1_NFT',
      compressed: false,
      edition: { isOriginal: false },
      decimals: 0,
    });
    addressService.findAssociatedTokenAddress.mockResolvedValue('ata-address');
    burnService.burnEditionsTransaction.mockResolvedValue({ transaction: 'edition' });

    const result = await service.createBurnTransaction('edition-mint', 'owner-address', locals);

    expect(burnService.burnEditionsTransaction).toHaveBeenCalled();
    expect(result).toEqual({ transaction: 'edition' });
  });

  test('an asset with unknown decimals still routes normally', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'V1_NFT',
      compressed: false,
      edition: { isOriginal: true },
      decimals: null,
    });
    burnService.burnMasterEditionTransaction.mockResolvedValue({ transaction: 'master' });

    await expect(
      service.createBurnTransaction('legacy-mint', 'owner-address', locals)
    ).resolves.toEqual({ transaction: 'master' });
  });
});
describe('transfer routing', () => {
  const locals = { network: { config: { nodeUrl: 'http://localhost:8899' } } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a Metaplex Core asset instead of letting transferV1 fail', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'MplCoreAsset',
      compressed: false,
      decimals: 0,
    });

    // These show up in the NFT listing, so the wallet's send flow reaches
    // them; transferV1 answered "Metadata account not found" as a 500.
    await expect(
      service.createTransferTransaction('core-mint', 'owner-address', 'dest-address', locals)
    ).rejects.toMatchObject({ statusCode: 422, errorCode: 'transfer_not_supported' });
  });
});
describe('ownership check', () => {
  const locals = { network: { config: { nodeUrl: 'http://localhost:8899' } } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses to build a print-edition burn for someone who does not own it', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'V1_NFT',
      compressed: false,
      edition: { isOriginal: false },
      decimals: 0,
      owner: 'someone-else',
    });

    // This path assembles a raw SPL Burn + closeAccount from the caller's ATA
    // without consulting the mint's owner, so a non-owner used to get 200 and
    // a transaction that fails on chain for an unrelated-looking reason.
    await expect(
      service.createBurnTransaction('edition-mint', 'not-the-owner', locals)
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(burnService.burnEditionsTransaction).not.toHaveBeenCalled();
  });

  it('refuses a transfer requested by a non-owner', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'V1_NFT',
      compressed: false,
      decimals: 0,
      owner: 'someone-else',
    });

    await expect(
      service.createTransferTransaction('mint', 'not-the-owner', 'destination', locals)
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('still builds when the caller is the owner', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'V1_NFT',
      compressed: false,
      edition: { isOriginal: false },
      decimals: 0,
      owner: 'the-owner',
    });
    addressService.findAssociatedTokenAddress.mockResolvedValue('ata');
    burnService.burnEditionsTransaction.mockResolvedValue({ transaction: 'edition' });

    await expect(
      service.createBurnTransaction('edition-mint', 'the-owner', locals)
    ).resolves.toEqual({ transaction: 'edition' });
  });

  it('does not block when the indexer reports no owner', async () => {
    repository.findFromSourceWithMint.mockResolvedValue({
      tokenStandard: 'V1_NFT',
      compressed: false,
      edition: { isOriginal: true },
      decimals: 0,
      owner: null,
    });
    burnService.burnMasterEditionTransaction.mockResolvedValue({ transaction: 'master' });

    // Missing ownership data is not evidence of wrongdoing; the on-chain
    // builders still refuse a non-owner further down.
    await expect(service.createBurnTransaction('mint', 'whoever', locals)).resolves.toEqual({
      transaction: 'master',
    });
  });
});
