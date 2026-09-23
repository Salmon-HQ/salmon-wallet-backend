'use strict';

const { isHeldByOwner, transformDasAsset } = require('../das-shared');

const asset = (grouping) => ({ id: 'Mint111', content: {}, grouping });

describe('transformDasAsset collection.verified', () => {
  test('is null without a collection grouping', () => {
    expect(transformDasAsset(asset([]), 'o').collection).toBeNull();
  });

  test('is true when the provider omits the flag (default calls list verified only)', () => {
    expect(
      transformDasAsset(asset([{ group_key: 'collection', group_value: 'Coll1' }]), 'o').collection
    ).toEqual({ key: 'Coll1', verified: true });
  });

  test('is true when the provider reports verified: true', () => {
    expect(
      transformDasAsset(
        asset([{ group_key: 'collection', group_value: 'Coll1', verified: true }]),
        'o'
      ).collection.verified
    ).toBe(true);
  });

  test('is false when the provider reports verified: false', () => {
    expect(
      transformDasAsset(
        asset([{ group_key: 'collection', group_value: 'Coll1', verified: false }]),
        'o'
      ).collection.verified
    ).toBe(false);
  });
});

describe('transformDasAsset edition.isOriginal', () => {
  // As the indexer returns them on devnet: a master edition and a pNFT carry
  // edition_nonce 255 / 254, the PDA bump, not an edition number.
  const withSupply = (iface, tokenStandard, editionNonce) => ({
    id: 'Mint111',
    interface: iface,
    content: { metadata: { token_standard: tokenStandard } },
    supply: { print_max_supply: 0, print_current_supply: 0, edition_nonce: editionNonce },
  });

  test.each([
    ['a master edition', 'V1_NFT', 'NonFungible', 255, true],
    ['a programmable NFT', 'ProgrammableNFT', 'ProgrammableNonFungible', 254, true],
    ['a print edition', 'V1_PRINT', 'NonFungibleEdition', 253, false],
  ])('reads %s as original=%s', (_label, iface, standard, nonce, isOriginal) => {
    expect(transformDasAsset(withSupply(iface, standard, nonce), 'o').edition).toEqual({
      isOriginal,
    });
  });
});

describe('isHeldByOwner', () => {
  // A master edition burned with a bare SPL Burn + CloseAccount, as the
  // indexer returns it: still owned by the last holder, but supply 0.
  const ghost = {
    burnt: false,
    ownership: { owner: 'o' },
    token_info: { supply: 0, decimals: 0 },
  };

  test.each([
    ['a held NFT', { burnt: false, token_info: { supply: 1, balance: 1 } }, true],
    ['a burned token whose metadata was left behind', ghost, false],
    ['a token with no balance left', { burnt: false, token_info: { supply: 1, balance: 0 } }, false],
    ['a burnt asset', { burnt: true, token_info: { supply: 1, balance: 1 } }, false],
    ['a compressed NFT', { burnt: false, compression: { compressed: true } }, true],
    ['a burnt compressed NFT', { burnt: true, compression: { compressed: true } }, false],
    ['an asset without token info', { burnt: false }, true],
  ])('%s → %s', (_label, asset, held) => {
    expect(isHeldByOwner(asset)).toBe(held);
  });
});
