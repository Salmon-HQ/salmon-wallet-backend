'use strict';

jest.mock('../../shared/coingecko-service', () => ({
  getSolanaTokenList: jest.fn(),
  getSolanaCoinIds: jest.fn(),
  getSolanaMarketRanks: jest.fn(),
}));

const coingecko = require('../../shared/coingecko-service');
const catalog = require('../token-catalog-service');

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const list = [
  { address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: 'usdc.png' },
  { address: BONK, symbol: 'Bonk', name: 'Bonk', decimals: 5, logoURI: 'bonk.png' },
  { address: 'USDCet111', symbol: 'USDCet', name: 'USD Coin (Wormhole)', decimals: 6 },
  { address: 'Cat111', symbol: 'USDC', name: 'UpSide Down Cat', decimals: 6 },
  { address: 'broken', symbol: null, decimals: 6 },
];

describe('token-catalog-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    catalog.clearSnapshot();
    coingecko.getSolanaTokenList.mockResolvedValue(list);
    coingecko.getSolanaCoinIds.mockResolvedValue(
      new Map([
        [USDC, 'usd-coin'],
        [BONK, 'bonk'],
        ['Cat111', 'upside-down-cat'],
      ])
    );
    coingecko.getSolanaMarketRanks.mockResolvedValue(
      new Map([
        ['usd-coin', 2],
        ['bonk', 40],
      ])
    );
  });

  it('builds the verified catalog in canonical shape, joined with coin ids, skipping malformed rows', async () => {
    const tokens = await catalog.getVerified();

    expect(tokens).toHaveLength(4);
    expect(tokens[0]).toEqual({
      id: USDC,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      icon: 'usdc.png',
      tags: ['verified'],
      coingeckoId: 'usd-coin',
      rank: 2,
    });
    // ranked first (USDC 2, BONK 40), then the unranked alphabetically
    expect(tokens.map((t) => t.name)).toEqual([
      'USD Coin',
      'Bonk',
      'UpSide Down Cat',
      'USD Coin (Wormhole)',
    ]);
    expect(tokens[3].coingeckoId).toBeNull();
    await catalog.getVerified();
    expect(coingecko.getSolanaTokenList).toHaveBeenCalledTimes(1);
  });

  it('ranks search: exact symbol, symbol prefix, name prefix, substring; case-insensitive', async () => {
    const bySymbol = await catalog.search('usdc');
    expect(bySymbol.map((t) => t.name)).toEqual([
      'USD Coin',
      'UpSide Down Cat',
      'USD Coin (Wormhole)',
    ]);

    const byName = await catalog.search('usd coin');
    expect(byName.map((t) => t.symbol)).toEqual(['USDC', 'USDCet']);

    const byMint = await catalog.search(BONK);
    expect(byMint.map((t) => t.symbol)).toEqual(['Bonk']);

    expect(await catalog.search('   ')).toEqual([]);
    expect(await catalog.search('zzz')).toEqual([]);
  });

  it('looks up listed tokens by mint', async () => {
    expect((await catalog.byMint(USDC)).symbol).toBe('USDC');
    expect(await catalog.byMint('nope')).toBeNull();
    const many = await catalog.byMints([USDC, 'nope']);
    expect([...many.keys()]).toEqual([USDC]);
  });

  it('falls back to alphabetical order when market ranks are unavailable', async () => {
    coingecko.getSolanaMarketRanks.mockRejectedValue(new Error('429'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const tokens = await catalog.getVerified();

    expect(tokens.map((t) => t.symbol)).toEqual(['Bonk', 'USDC', 'USDC', 'USDCet']);
    // without ranks nothing can be told apart: everything listed is community
    expect(tokens.every((t) => t.tags[0] === 'community')).toBe(true);
    warn.mockRestore();
  });

  it('propagates a source failure instead of an empty catalog', async () => {
    coingecko.getSolanaTokenList.mockRejectedValue(new Error('503'));
    await expect(catalog.getVerified()).rejects.toThrow('503');
  });
});
