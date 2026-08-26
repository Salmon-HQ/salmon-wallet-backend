'use strict';

jest.mock('../../../repositories/solana/nft-metadata-repository', () => ({
  getOffchainMetadata: jest.fn(),
}));

const repository = require('../../../repositories/solana/nft-metadata-repository');
const hydrator = require('../nft-metadata-hydrator');

beforeEach(() => jest.clearAllMocks());

// What Triton's DAS index hands back: on-chain fields only.
const tritonShaped = {
  mint: { address: 'CNM8' },
  uri: 'https://arweave.net/7yIi',
  json: {
    name: 'Mindfolk Founder #5154',
    symbol: 'MNDFLK',
    token_standard: 'ProgrammableNonFungible',
  },
};

// What Helius hands back: the off-chain document already merged in.
const heliusShaped = {
  mint: { address: 'CNM8' },
  uri: 'https://arweave.net/7yIi',
  json: {
    name: 'Mindfolk Founder #5154',
    description: 'A collection of 10,000 unique explorations of well traveled Mindfolk.',
    attributes: [{ trait_type: 'Background', value: 'Blue' }],
  },
};

describe('hydrate', () => {
  test('merges the off-chain document into json and marks it resolved', async () => {
    repository.getOffchainMetadata.mockResolvedValue({
      name: 'Mindfolk Founder #5154',
      description: 'A collection of 10,000 unique explorations of well traveled Mindfolk.',
      image: 'https://arweave.net/image.png',
      attributes: [{ trait_type: 'Background', value: 'Blue' }],
    });

    const result = await hydrator.hydrate(tritonShaped, {});

    expect(result.metadataResolved).toBe(true);
    expect(result.json.description).toBe(
      'A collection of 10,000 unique explorations of well traveled Mindfolk.'
    );
    expect(result.json.attributes).toHaveLength(1);
    expect(result.json.image).toBe('https://arweave.net/image.png');
  });

  test('keeps the on-chain name and symbol as authoritative', async () => {
    repository.getOffchainMetadata.mockResolvedValue({
      name: 'Spoofed',
      symbol: 'FAKE',
      description: 'x',
    });

    const result = await hydrator.hydrate(tritonShaped, {});

    expect(result.json.name).toBe('Mindfolk Founder #5154');
    expect(result.json.symbol).toBe('MNDFLK');
  });

  // The whole point of the fail-open path: a dead pin must not cost the owner
  // their NFT in the listing.
  test('marks the NFT unresolved and fetches nothing more when the document is gone', async () => {
    repository.getOffchainMetadata.mockResolvedValue(null);

    const result = await hydrator.hydrate(tritonShaped, {});

    expect(result.metadataResolved).toBe(false);
    expect(result.json).toEqual(tritonShaped.json);
  });

  test('marks an NFT with no uri unresolved rather than assuming it is barebones', async () => {
    const result = await hydrator.hydrate({ mint: { address: 'X' }, json: {} }, {});

    expect(result.metadataResolved).toBe(false);
    expect(repository.getOffchainMetadata).not.toHaveBeenCalled();
  });

  test('skips the fetch entirely when the provider already hydrated the metadata', async () => {
    const result = await hydrator.hydrate(heliusShaped, {});

    expect(result.metadataResolved).toBe(true);
    expect(repository.getOffchainMetadata).not.toHaveBeenCalled();
  });

  test('normalizes an ipfs:// uri to a fetchable gateway url', async () => {
    repository.getOffchainMetadata.mockResolvedValue({ description: 'x' });

    await hydrator.hydrate({ ...tritonShaped, uri: 'ipfs://bafyabc' }, {});

    expect(repository.getOffchainMetadata).toHaveBeenCalledWith('https://ipfs.io/ipfs/bafyabc', {});
  });
});

describe('hydrateMany', () => {
  test('hydrates every NFT in the page', async () => {
    repository.getOffchainMetadata.mockResolvedValue({ description: 'real' });

    const result = await hydrator.hydrateMany(
      [tritonShaped, { ...tritonShaped, mint: { address: 'B' } }],
      {}
    );

    expect(result).toHaveLength(2);
    expect(result.every((nft) => nft.metadataResolved)).toBe(true);
    expect(repository.getOffchainMetadata).toHaveBeenCalledTimes(2);
  });

  test('preserves input order even though fetches run concurrently', async () => {
    repository.getOffchainMetadata.mockImplementation(async (url) => {
      const delay = url.endsWith('slow') ? 20 : 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return { description: url };
    });

    const result = await hydrator.hydrateMany(
      [
        { mint: { address: 'A' }, uri: 'https://arweave.net/slow', json: {} },
        { mint: { address: 'B' }, uri: 'https://arweave.net/fast', json: {} },
      ],
      {}
    );

    expect(result.map((nft) => nft.mint.address)).toEqual(['A', 'B']);
    expect(result[0].json.description).toBe('https://arweave.net/slow');
  });

  test('caps concurrency so a large wallet cannot fan out without bound', async () => {
    const { CONCURRENCY } = hydrator.__testing;
    let inFlight = 0;
    let peak = 0;

    repository.getOffchainMetadata.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { description: 'x' };
    });

    const nfts = Array.from({ length: 30 }, (_, i) => ({
      mint: { address: `M${i}` },
      uri: `https://arweave.net/${i}`,
      json: {},
    }));

    await hydrator.hydrateMany(nfts, {});

    expect(peak).toBeLessThanOrEqual(CONCURRENCY);
  });

  test('returns an empty list untouched', async () => {
    expect(await hydrator.hydrateMany([], {})).toEqual([]);
    expect(repository.getOffchainMetadata).not.toHaveBeenCalled();
  });
});
