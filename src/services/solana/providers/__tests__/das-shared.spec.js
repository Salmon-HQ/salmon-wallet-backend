'use strict';

const { transformDasAsset } = require('../das-shared');

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
