'use strict';

/**
 * Abuse case: blocklist evasion. An entry is compared as a suffix of
 * `new URL(...).hostname`, so an entry that is stored in any other spelling
 * names a phishing site and never flags it.
 */

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../../repositories/shared/scam-repository', () => ({
  getUrls: jest.fn(),
  saveUrls: jest.fn(),
}));

const http = require('axios');
const repository = require('../../../repositories/shared/scam-repository');
const service = require('../scam-service');

const listed = async (entries) => {
  repository.getUrls.mockResolvedValue(null);
  http.get.mockResolvedValue({ data: entries.map((url) => `- url: "${url}"`).join('\n') });
  return service.listUrls('solana', {});
};

describe('abuse: a blocklist entry that never matches its own site', () => {
  test.each([
    ['https://scam.com/claim', 'scam.com'],
    ['http://Scam.COM', 'scam.com'],
    ['HTTPS://scam.com:8443/x?y=1#z', 'scam.com'],
    ['scam.com/claim?ref=1', 'scam.com'],
    ['  Scam.com  ', 'scam.com'],
    ['metapléx.com', 'xn--metaplx-gya.com'],
    ['https://metapléx.com/mint', 'xn--metaplx-gya.com'],
  ])('%s is stored as the hostname %s', async (entry, hostname) => {
    expect(await listed([entry])).toEqual([hostname]);
  });

  test('every stored entry is a suffix of the hostname of the URL it came from', async () => {
    const entries = ['https://a.scam.io/x', 'http://b.scam.io', 'c.scam.io/path'];
    const urls = await listed(entries);

    entries.forEach((entry, i) => {
      const visited = new URL(entry.includes('://') ? entry : `https://${entry}`).hostname;
      expect(visited.endsWith(urls[i])).toBe(true);
    });
  });
});
