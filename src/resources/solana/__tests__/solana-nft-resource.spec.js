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

describe('Token-2022 NFT read from its group (Seeker Genesis Token)', () => {
  // The listing item after the Token-2022 read and the off-chain hydration,
  // with the document Solana Mobile publishes at the group's URI.
  const sgt = {
    mint: { address: '5vPkA3YXK6ByvioKaEyQofqT4QXVWMCXqpvYshswXkCb' },
    owner: 'CzNRNm6vbDiJ2MG96Lw4gSZW1gSjeV6DgSEAjCULxXcJ',
    name: 'Seeker Genesis Token',
    symbol: 'SeekerGT',
    uri: 'https://r2.solanamobiledappstore.com/skr/sgt-metadata.json',
    extensions: [{ extension: 'immutableOwner' }],
    tokenAmount: { decimals: 0, amount: '1', uiAmount: 1 },
    frozen: true,
    json: {
      description:
        'A non-transferable NFT for Seeker owners, unlocking exclusive onchain experiences throughout the Solana ecosystem.',
      image: 'https://r2.solanamobiledappstore.com/skr/seeker-genesis-token.png',
      animation_url: 'https://r2.solanamobiledappstore.com/skr/seeker-genesis-token.mp4',
      properties: { category: 'video' },
    },
    metadataResolved: true,
  };

  test('is shown with its image and animation, not scored as spam', async () => {
    const result = await decorate(sgt, {}, 'k', {});

    expect(result).toMatchObject({
      name: 'Seeker Genesis Token',
      media: 'https://r2.solanamobiledappstore.com/skr/seeker-genesis-token.png',
      animation: 'https://r2.solanamobiledappstore.com/skr/seeker-genesis-token.mp4',
      frozen: true,
    });
    expect(result.spamScore).toBeLessThan(2);
  });

  test('an NFT without animation or freeze says so', async () => {
    const result = await decorate(baseNft, {}, 'k', {});

    expect(result).toMatchObject({ animation: null, frozen: false });
  });
});
