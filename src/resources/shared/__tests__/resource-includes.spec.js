'use strict';

jest.mock('../../../services/shared/scam-service', () => ({
  listUrls: jest.fn(),
}));

jest.mock('../../../services/shared/trustwallet-service', () => ({
  listTokens: jest.fn(),
  getNativeLogo: jest.fn((blockchain) => `https://cdn.example/${blockchain}/logo.png`),
}));

const scamService = require('../../../services/shared/scam-service');
const trustwalletService = require('../../../services/shared/trustwallet-service');
const { includeBlacklisted, includeLogo } = require('../resource-includes');

describe('includeBlacklisted', () => {
  const run = async (resource, context = {}) => {
    await includeBlacklisted('solana', resource, { blacklisted: true }, 'nft', context);
    return resource;
  };

  beforeEach(() => {
    scamService.listUrls.mockResolvedValue(['scam.example']);
  });

  it('passes request locals through so the scam list is cached per network', async () => {
    const locals = { network: { id: 'solana-mainnet' } };

    await run({ media: null, uri: null }, { locals });

    expect(scamService.listUrls).toHaveBeenCalledWith('solana', locals);
  });

  it('flags a resource whose media hostname matches the scam list', async () => {
    const resource = await run({ media: 'https://cdn.scam.example/x.png', uri: null });

    expect(resource.blacklisted).toBe(true);
  });

  it('does not throw on a malformed media or uri value from token metadata', async () => {
    const resource = await run({ media: 'not a url', uri: 'ipfs-without-scheme/abc' });

    expect(resource.blacklisted).toBe(false);
  });

  it('still matches the parseable field when the other one is malformed', async () => {
    const resource = await run({ media: 'garbage', uri: 'https://scam.example/meta.json' });

    expect(resource.blacklisted).toBe(true);
  });
});

describe('includeLogo', () => {
  const run = async (resource) => {
    await includeLogo(resource, { logo: true }, 'balance', {});
    return resource;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves a native logo without fetching the token list', async () => {
    const resource = await run({ type: 'native', blockchain: 'bitcoin' });

    expect(trustwalletService.listTokens).not.toHaveBeenCalled();
    expect(resource.logo).toBe('https://cdn.example/bitcoin/logo.png');
  });

  it('looks a token logo up in the token list by address', async () => {
    trustwalletService.listTokens.mockResolvedValue([
      { address: '0xABC', logoURI: 'https://l/abc.png' },
    ]);

    const resource = await run({ type: 'token', blockchain: 'ethereum', address: '0xabc' });

    expect(resource.logo).toBe('https://l/abc.png');
  });
});
