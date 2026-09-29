'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

jest.mock('../../../repositories/shared/scam-repository', () => ({
  getUrls: jest.fn(),
  saveUrls: jest.fn(),
}));

const http = require('axios');
const repository = require('../../../repositories/shared/scam-repository');
const service = require('../scam-service');

describe('scam-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty list for unsupported blockchain', async () => {
    const result = await service.listUrls('dogecoin', {});

    expect(result).toEqual([]);
    expect(repository.getUrls).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  });

  it('returns cached urls when present', async () => {
    repository.getUrls.mockResolvedValue(['cached.com']);

    const result = await service.listUrls('solana', {});

    expect(result).toEqual(['cached.com']);
    expect(http.get).not.toHaveBeenCalled();
    expect(repository.saveUrls).not.toHaveBeenCalled();
  });

  it('loads, normalizes and caches remote urls', async () => {
    repository.getUrls.mockResolvedValue(null);
    http.get.mockResolvedValue({
      data: `
- url: Example.COM
- url: Another.io
`,
    });

    const result = await service.listUrls('solana', { stage: 'test' });

    expect(result).toEqual(['example.com', 'another.io']);
    expect(repository.saveUrls).toHaveBeenCalledWith('solana', ['example.com', 'another.io'], {
      stage: 'test',
    });
  });

  // The live Phantom feed lists IDN homograph domains in Unicode
  // (metapléx.com, premínt.xyz, y00tś.com, åssetdäsh.com), while the hostname
  // they are compared against comes from `new URL()` and is always punycode.
  // Stored unconverted, those entries can never match the domain they name —
  // and they name the phishing sites that imitate the real ones.
  it('converts an internationalized domain to the punycode a hostname is', async () => {
    repository.getUrls.mockResolvedValue(null);
    http.get.mockResolvedValue({
      data: `
- url: metapléx.com
- url: PREMÍNT.xyz
`,
    });

    const result = await service.listUrls('solana', { stage: 'test' });

    expect(result).toEqual(['xn--metaplx-gya.com', 'xn--premnt-6va.xyz']);
    expect(new URL('https://metapléx.com/x').hostname.endsWith(result[0])).toBe(true);
  });
});
