'use strict';

const { lookup, __resetForTests } = require('../nft-image-override-service');
const seed = require('../data/nft-image-overrides.json');

describe('nft-image-override-service.lookup', () => {
  beforeEach(() => {
    __resetForTests();
  });

  test('returns null for missing or non-string mint', () => {
    expect(lookup(undefined)).toBeNull();
    expect(lookup('')).toBeNull();
    expect(lookup(null)).toBeNull();
    expect(lookup(123)).toBeNull();
  });

  test('returns null for an unknown mint', () => {
    expect(lookup('UnknownMint11111111111111111111111111111111')).toBeNull();
  });

  test('seed bundles at least one entry', () => {
    expect(Object.keys(seed).length).toBeGreaterThan(0);
  });

  test('returns the mapped URL for a known seed entry', () => {
    const [knownMint] = Object.keys(seed);
    expect(lookup(knownMint)).toBe(seed[knownMint]);
  });

  test('seed entries are all https Arweave URLs', () => {
    Object.values(seed)
      .slice(0, 100)
      .forEach((url) => {
        expect(typeof url).toBe('string');
        expect(url.startsWith('https://')).toBe(true);
      });
  });
});
