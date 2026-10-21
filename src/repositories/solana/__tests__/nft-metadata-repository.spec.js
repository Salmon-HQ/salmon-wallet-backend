'use strict';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../helper', () => ({
  getCacheKey: jest.fn((suffix) => `key:${suffix}`),
  getFromCache: jest.fn(),
  storeInCache: jest.fn(),
}));

const http = require('axios');
const { getFromCache, storeInCache } = require('../../helper');
const repository = require('../nft-metadata-repository');

const { isBlockedIp, asMetadataObject } = repository.__testing;

beforeEach(() => {
  jest.clearAllMocks();
  getFromCache.mockResolvedValue(null);
  storeInCache.mockResolvedValue(undefined);
});

// The json_uri is attacker-controlled — anyone can mint an NFT pointing at an
// internal address — so this guard is the thing standing between the indexer
// and an SSRF pivot into cloud instance metadata.
describe('isBlockedIp', () => {
  test.each([
    ['169.254.169.254', 'cloud instance metadata'],
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private class A'],
    ['172.16.0.1', 'private class B'],
    ['172.31.255.255', 'private class B upper bound'],
    ['192.168.1.1', 'private class C'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', 'unspecified'],
    ['239.255.255.250', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['fd00::1', 'IPv6 unique local'],
    ['fe80::1', 'IPv6 link-local'],
    ['fe9a::1', 'IPv6 link-local, fe80::/10 beyond fe80'],
    ['febf:ffff::1', 'IPv6 link-local upper bound'],
    ['192.0.0.9', 'IETF protocol assignments (192.0.0.0/24)'],
    ['198.18.0.1', 'benchmarking (198.18.0.0/15)'],
    ['198.19.255.255', 'benchmarking upper bound'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata address'],
    ['not-an-ip', 'unparseable input fails closed'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  test.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['172.15.0.1'],
    ['172.32.0.1'],
    ['192.0.1.1'],
    ['198.20.0.1'],
    ['fec0::1'],
    ['2606:4700::1111'],
  ])('allows public address %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe('asMetadataObject', () => {
  test('parses JSON served as text/plain', () => {
    expect(asMetadataObject('{"description":"hi"}')).toEqual({ description: 'hi' });
  });

  test('rejects a non-object payload', () => {
    expect(asMetadataObject('[1,2,3]')).toBeNull();
    expect(asMetadataObject('nonsense')).toBeNull();
    expect(asMetadataObject(null)).toBeNull();
  });
});

describe('getOffchainMetadata', () => {
  const url = 'https://arweave.net/abc';

  test('fetches, returns, and caches the document on a hit', async () => {
    http.get.mockResolvedValue({ data: { description: 'A real NFT', attributes: [] } });

    const result = await repository.getOffchainMetadata(url, {});

    expect(result).toEqual({ description: 'A real NFT', attributes: [] });
    expect(storeInCache).toHaveBeenCalledWith(
      expect.any(String),
      { ok: true, json: { description: 'A real NFT', attributes: [] } },
      expect.any(Number)
    );
  });

  // The document is attacker-chosen and lands in the Redis every other
  // feature shares, so only what the NFT resource reads is kept, and bounded.
  test('stores only the fields the NFT resource reads, capped', async () => {
    const { MAX_DESCRIPTION_CHARS, MAX_ATTRIBUTES } = repository.__testing;
    http.get.mockResolvedValue({
      data: {
        name: 'n',
        description: 'd'.repeat(MAX_DESCRIPTION_CHARS + 500),
        image: 'https://arweave.net/i.png',
        attributes: Array.from({ length: MAX_ATTRIBUTES + 20 }, (_, i) => ({ value: i })),
        properties: { category: 'image' },
        padding: 'x'.repeat(100000),
      },
    });

    const result = await repository.getOffchainMetadata(url, {});

    expect(Object.keys(result).sort()).toEqual([
      'attributes',
      'description',
      'image',
      'name',
      'properties',
    ]);
    expect(result.description).toHaveLength(MAX_DESCRIPTION_CHARS);
    expect(result.attributes).toHaveLength(MAX_ATTRIBUTES);
    expect(storeInCache).toHaveBeenCalledWith(
      expect.any(String),
      { ok: true, json: result },
      expect.any(Number)
    );
  });

  // An oversized document keeps what the listing shows (name, description,
  // image); the bulky extras go first, and only a document still too large
  // without them is discarded.
  test('drops properties, creators and attributes before discarding a large document', async () => {
    const { MAX_STORED_BYTES } = repository.__testing;
    http.get.mockResolvedValue({
      data: {
        description: 'ok',
        image: 'https://arweave.net/i.png',
        attributes: [{ value: 'a' }],
        creators: [{ address: 'c'.repeat(MAX_STORED_BYTES) }],
        properties: { files: ['f'.repeat(MAX_STORED_BYTES)] },
      },
    });

    const result = await repository.getOffchainMetadata(url, {});

    expect(result).toEqual({
      description: 'ok',
      image: 'https://arweave.net/i.png',
      attributes: [{ value: 'a' }],
    });
  });

  test('stores no document that is still over the size cap without its extras', async () => {
    const { MAX_STORED_BYTES } = repository.__testing;
    http.get.mockResolvedValue({
      data: { description: 'ok', image: 'i'.repeat(MAX_STORED_BYTES) },
    });

    const result = await repository.getOffchainMetadata(url, {});

    expect(result).toBeNull();
    expect(storeInCache).toHaveBeenCalledWith(expect.any(String), { ok: false }, 60 * 60);
  });

  // The resource and the spam detector call string methods on these fields;
  // an attacker's object or number there must not reach them.
  test('keeps a field only when it has the type the resource reads', async () => {
    http.get.mockResolvedValue({
      data: {
        name: { evil: true },
        symbol: 7,
        description: ['d'],
        image: { url: 'x' },
        animation_url: 'https://arweave.net/a.mp4',
        collection: 'not-an-object',
        attributes: { not: 'an array' },
        properties: ['not', 'an object'],
        creators: 'nobody',
      },
    });

    const result = await repository.getOffchainMetadata(url, {});

    expect(result).toEqual({ animation_url: 'https://arweave.net/a.mp4' });
  });

  // Entries written before the fields were trimmed held whole documents for
  // 30 days; a new key version stops them from being served.
  test('reads and writes a versioned cache key', async () => {
    http.get.mockResolvedValue({ data: { description: 'x' } });

    await repository.getOffchainMetadata(url, {});

    expect(getFromCache).toHaveBeenCalledWith(expect.stringContaining('nft_offchain_metadata:v2:'));
    expect(storeInCache).toHaveBeenCalledWith(
      expect.stringContaining('nft_offchain_metadata:v2:'),
      expect.any(Object),
      expect.any(Number)
    );
  });

  // A content-addressed document cannot change; anything else can, and is
  // the attacker's own server, so it is kept a day rather than a month.
  test.each([
    [`https://arweave.net/${'a'.repeat(43)}`, 30 * 24 * 60 * 60],
    [
      'https://ipfs.filebase.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      30 * 24 * 60 * 60,
    ],
    ['https://metadata.example/1.json', 24 * 60 * 60],
    [
      'https://attacker.example/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      24 * 60 * 60,
    ],
    ['https://name.arweave.net/1.json', 24 * 60 * 60],
    [`https://arweave.net/${'a'.repeat(43)}/1.json`, 30 * 24 * 60 * 60],
    [`https://arweave.net/${'a'.repeat(43)}?ext=json`, 30 * 24 * 60 * 60],
    [`https://arweave.net/${'a'.repeat(50)}`, 24 * 60 * 60],
    ['https://ipfs.filebase.io/ipfs/../attacker.json', 24 * 60 * 60],
  ])('keeps %s for %i seconds', async (documentUrl, ttl) => {
    http.get.mockResolvedValue({ data: { description: 'x' } });

    await repository.getOffchainMetadata(documentUrl, {});

    expect(storeInCache).toHaveBeenCalledWith(expect.any(String), expect.any(Object), ttl);
  });

  test('serves a cached document without re-fetching', async () => {
    getFromCache.mockResolvedValue({ ok: true, json: { description: 'cached' } });

    const result = await repository.getOffchainMetadata(url, {});

    expect(result).toEqual({ description: 'cached' });
    expect(http.get).not.toHaveBeenCalled();
  });

  // Dead IPFS pins are common. Without a negative cache, a wallet holding a few
  // of them would eat the full fetch timeout on every single request.
  test('caches the failure and returns null when the fetch throws', async () => {
    http.get.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await repository.getOffchainMetadata(url, {});

    expect(result).toBeNull();
    expect(storeInCache).toHaveBeenCalledWith(
      expect.any(String),
      { ok: false },
      expect.any(Number)
    );
  });

  // axios's `timeout` stops counting once the headers arrive, so a server
  // that trickles its body one byte at a time held the listing until the
  // Lambda timed out. The deadline has to cover the whole exchange.
  describe('a server that never finishes its body', () => {
    const hangUntilAborted = (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('canceled')));
      });

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('is cut off at the per-fetch deadline and cached as a failure', async () => {
      const { FETCH_TIMEOUT_MS } = repository.__testing;
      http.get.mockImplementation(hangUntilAborted);

      const pending = repository.getOffchainMetadata(url, {});
      await jest.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

      await expect(pending).resolves.toBeNull();
      expect(storeInCache).toHaveBeenCalledWith(expect.any(String), { ok: false }, 60 * 60);
    });

    test('is cut off when the listing runs out of time, without blaming the server', async () => {
      http.get.mockImplementation(hangUntilAborted);
      const listing = new AbortController();

      const pending = repository.getOffchainMetadata(url, {}, listing.signal);
      await jest.advanceTimersByTimeAsync(10);
      listing.abort();

      await expect(pending).resolves.toBeNull();
      expect(storeInCache).not.toHaveBeenCalled();
    });
  });

  test('does not re-fetch a known-bad document', async () => {
    getFromCache.mockResolvedValue({ ok: false });

    const result = await repository.getOffchainMetadata(url, {});

    expect(result).toBeNull();
    expect(http.get).not.toHaveBeenCalled();
  });

  test('refuses a non-http protocol', async () => {
    const result = await repository.getOffchainMetadata('file:///etc/passwd', {});

    expect(result).toBeNull();
    expect(http.get).not.toHaveBeenCalled();
  });

  // Node never calls the agent's `lookup` hook for a host that is already an
  // IP literal, so guardedLookup does not see these connections at all: the
  // URL-level check is the only thing that stops them.
  test.each([
    ['http://169.254.169.254/latest/meta-data/', 'cloud instance metadata'],
    ['http://127.0.0.1:8080/metadata.json', 'loopback'],
    ['http://10.0.0.5/metadata.json', 'private range'],
    ['http://[::1]:8080/metadata.json', 'IPv6 loopback'],
    ['http://[::ffff:7f00:1]/metadata.json', 'IPv4-mapped loopback in hex groups'],
  ])('refuses the IP-literal host in %s (%s)', async (url) => {
    const result = await repository.getOffchainMetadata(url, {});

    expect(result).toBeNull();
    expect(http.get).not.toHaveBeenCalled();
  });

  test('still fetches a hostname destination', async () => {
    http.get.mockResolvedValue({ data: { description: 'ok', image: 'i', attributes: [] } });

    const result = await repository.getOffchainMetadata('https://metadata.example/x.json', {});

    expect(result).toEqual({ description: 'ok', image: 'i', attributes: [] });
    expect(http.get).toHaveBeenCalled();
  });
});
