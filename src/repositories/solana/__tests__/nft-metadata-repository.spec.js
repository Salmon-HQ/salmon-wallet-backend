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
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata address'],
    ['not-an-ip', 'unparseable input fails closed'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  test.each([['8.8.8.8'], ['1.1.1.1'], ['172.15.0.1'], ['172.32.0.1'], ['2606:4700::1111']])(
    'allows public address %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    }
  );
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
});
