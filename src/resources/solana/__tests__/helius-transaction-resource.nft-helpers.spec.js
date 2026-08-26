'use strict';

/**
 * Unit tests for the NFT-side helpers in helius-transaction-resource:
 *   - collectNftMints: pulls NonFungible / NonFungibleEdition mints from
 *     tokenTransfers
 *   - markNftTransfers: stamps `isNft=true`, `amount='1'`, `decimals=0` and
 *     copies the mint into `contract` for items whose contract is in the
 *     nftMints set
 *   - enrichWithNftMetadata: overlays metadata fields (name/symbol/image)
 *     onto items already marked as NFT
 */

const { __testing } = require('../helius-transaction-resource');
const { collectNftMints, markNftTransfers, enrichWithNftMetadata } = __testing;

describe('collectNftMints', () => {
  test('extracts NonFungible mints from tokenTransfers', () => {
    const tx = {
      tokenTransfers: [
        { mint: 'M1', tokenStandard: 'NonFungible' },
        { mint: 'M2', tokenStandard: 'Fungible' },
        { mint: 'M3', tokenStandard: 'NonFungibleEdition' },
      ],
      nativeTransfers: [],
    };
    expect(collectNftMints(tx)).toEqual(['M1', 'M3']);
  });

  test('returns empty array when no NFT transfers', () => {
    expect(
      collectNftMints({
        tokenTransfers: [{ mint: 'M', tokenStandard: 'Fungible' }],
        nativeTransfers: [],
      })
    ).toEqual([]);
  });

  test('handles missing tokenTransfers', () => {
    expect(collectNftMints({ nativeTransfers: [] })).toEqual([]);
  });
});

describe('markNftTransfers', () => {
  test('stamps isNft, amount=1, decimals=0 for items in nftMints', () => {
    const items = [
      { contract: 'M1', amount: '999', decimals: 9 },
      { contract: 'M2', amount: '5', decimals: 6 },
    ];
    markNftTransfers(items, ['M1']);
    expect(items[0]).toMatchObject({
      contract: 'M1',
      isNft: true,
      amount: '1',
      decimals: 0,
    });
    expect(items[1]).not.toHaveProperty('isNft');
    expect(items[1].amount).toBe('5');
  });

  test('no-op when nftMints is empty', () => {
    const items = [{ contract: 'M', amount: '5' }];
    markNftTransfers(items, []);
    expect(items[0]).not.toHaveProperty('isNft');
  });

  test('items whose contract is not in mint set are untouched', () => {
    const items = [{ contract: 'NotAnNft', amount: '5' }];
    markNftTransfers(items, ['SomeOtherMint']);
    expect(items[0]).not.toHaveProperty('isNft');
  });
});

describe('enrichWithNftMetadata', () => {
  const baseItem = () => ({
    contract: 'NFT-MINT',
    isNft: true,
    amount: '1',
    decimals: 0,
    name: 'placeholder',
    symbol: 'PLC',
    logo: null,
  });

  test('copies name / symbol / image when metadata present', () => {
    const items = [baseItem()];
    const metadata = new Map([
      ['NFT-MINT', { name: 'Cool', symbol: 'COOL', image: 'https://x/x.png' }],
    ]);
    enrichWithNftMetadata(items, metadata);
    expect(items[0]).toMatchObject({
      name: 'Cool',
      symbol: 'COOL',
      logo: 'https://x/x.png',
    });
  });

  test('only copies fields that are present (truthy)', () => {
    const items = [baseItem()];
    const metadata = new Map([['NFT-MINT', { name: 'OnlyName' }]]);
    enrichWithNftMetadata(items, metadata);
    expect(items[0].name).toBe('OnlyName');
    // symbol/logo untouched
    expect(items[0].symbol).toBe('PLC');
    expect(items[0].logo).toBeNull();
  });

  test('skips items not marked as NFT', () => {
    const items = [{ ...baseItem(), isNft: false }];
    const metadata = new Map([['NFT-MINT', { name: 'Cool' }]]);
    enrichWithNftMetadata(items, metadata);
    expect(items[0].name).toBe('placeholder');
  });

  test('skips when contract has no metadata entry', () => {
    const items = [baseItem()];
    enrichWithNftMetadata(items, new Map());
    expect(items[0].name).toBe('placeholder');
  });

  test('skips items with no contract', () => {
    const items = [{ isNft: true, amount: '1' }];
    enrichWithNftMetadata(items, new Map([['M', { name: 'X' }]]));
    expect(items[0].name).toBeUndefined();
  });
});
