'use strict';

jest.mock('../../../services/solana/nft-image-override-service', () => ({
  lookup: jest.fn(),
}));

jest.mock('../../shared/resource-includes', () => ({
  includeBlacklisted: jest.fn().mockResolvedValue(undefined),
}));

const imageOverrides = require('../../../services/solana/nft-image-override-service');
const decorate = require('../solana-nft-resource');

const baseNft = {
  mint: { address: 'CleanMint11111111111111111111111111111111111' },
  owner: 'OwnerWallet1111111111111111111111111111111',
  name: 'Mad Lads #1234',
  symbol: 'LADS',
  uri: 'ipfs://QmCid/metadata.json',
  json: {
    description: 'Genesis lad.',
    image: 'https://arweave.net/original.png',
    collection: { name: 'Mad Lads', verified: true },
    creators: [],
    attributes: [{ trait_type: 'Background', value: 'Blue' }],
    properties: {},
  },
  extensions: [],
  tokenStandard: 4, // ProgrammableNonFungible
  image: undefined,
};

describe('solana-nft-resource decorator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns null for fungible tokens', async () => {
    const result = await decorate({ ...baseNft, tokenStandard: 2 }, {}, 'k', {});
    expect(result).toBeNull();
  });

  test('uses image override when present, falling back to provider image', async () => {
    imageOverrides.lookup.mockReturnValue('https://arweave.net/override.png');

    const result = await decorate(baseNft, {}, 'k', {});

    expect(imageOverrides.lookup).toHaveBeenCalledWith(baseNft.mint.address);
    expect(result.media).toBe('https://arweave.net/override.png');
  });

  test('falls back to provider image when no override exists', async () => {
    imageOverrides.lookup.mockReturnValue(null);

    const result = await decorate(baseNft, {}, 'k', {});

    expect(result.media).toBe('https://arweave.net/original.png');
  });

  test('reads the page name counts from locals for duplicate_name', async () => {
    imageOverrides.lookup.mockReturnValue(null);
    const context = { locals: { nftNameCounts: { 'mad lads': 3 } } };

    const result = await decorate(baseNft, {}, 'k', context);

    expect(result.spamReasons).toEqual(['duplicate_name']);
    expect(result.spamScore).toBe(1);
  });

  test('scores without wallet context when locals carry no name counts', async () => {
    imageOverrides.lookup.mockReturnValue(null);

    const result = await decorate(baseNft, {}, 'k', {});

    expect(result.spamReasons).toEqual([]);
  });

  test('exposes on-chain DAS creators over the off-chain json list', async () => {
    imageOverrides.lookup.mockReturnValue(null);
    const creators = [{ address: 'Creator111', share: 100, verified: true }];

    const result = await decorate(
      { ...baseNft, creators, json: { ...baseNft.json, creators: [{ address: 'Other' }] } },
      {},
      'k',
      {}
    );

    expect(result.extras.creators).toEqual(creators);
  });

  test('falls back to off-chain json creators when DAS reports none', async () => {
    imageOverrides.lookup.mockReturnValue(null);
    const jsonCreators = [{ address: 'Other', share: 100 }];

    const result = await decorate(
      { ...baseNft, creators: [], json: { ...baseNft.json, creators: jsonCreators } },
      {},
      'k',
      {}
    );

    expect(result.extras.creators).toEqual(jsonCreators);
  });

  describe('on-chain collection shielding the barebones rules', () => {
    const bare = {
      ...baseNft,
      json: { description: undefined, attributes: undefined, collection: undefined },
    };

    test('a verified grouping shields a barebones NFT', async () => {
      imageOverrides.lookup.mockReturnValue(null);

      const result = await decorate(
        { ...bare, collection: { key: 'Coll1', verified: true } },
        {},
        'k',
        {}
      );

      expect(result.spamReasons).not.toContain('barebones_nft');
    });

    test('an unverified grouping does not shield a barebones NFT', async () => {
      imageOverrides.lookup.mockReturnValue(null);

      const result = await decorate(
        { ...bare, collection: { key: 'Coll1', verified: false } },
        {},
        'k',
        {}
      );

      expect(result.spamReasons).toContain('barebones_nft');
    });
  });

  test('emits spamScore and spamReasons (clean NFT scores 0)', async () => {
    imageOverrides.lookup.mockReturnValue(null);

    const result = await decorate(baseNft, {}, 'k', {});

    expect(result.spamScore).toBe(0);
    expect(result.spamReasons).toEqual([]);
  });

  test('flags spam reasons for a malicious NFT', async () => {
    imageOverrides.lookup.mockReturnValue(null);

    const malicious = {
      ...baseNft,
      name: 'JUP.PRO Drop Pass',
      json: {
        ...baseNft.json,
        description: 'Claim your free mint at https://drop.lol/claim',
        attributes: [{ trait_type: 'link', value: 'https://drop.lol' }],
        collection: { name: '', verified: false },
      },
    };

    const result = await decorate(malicious, {}, 'k', {});

    expect(result.spamScore).toBeGreaterThan(0);
    expect(result.spamReasons).toEqual(
      expect.arrayContaining(['domain_in_name', 'url_in_attributes', 'phishing_description'])
    );
  });
});
