'use strict';

jest.mock('../../../solana/jupiter-service', () => ({
  getQuotes: jest.fn(),
}));

const jupiterService = require('../../../solana/jupiter-service');
const { SOL_ADDRESS } = require('../../../../constants/solana-constants');
const { enrich } = require('../solana-price-enricher');

const buildSolItem = (lamports) => ({
  owner: 'sol-address',
  blockchain: 'solana',
  confirmed_balance: lamports,
  currency: {
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    type: 'native',
    asset_path: 'solana/native/sol',
  },
});

const buildSplItem = (mint, amount) => ({
  owner: 'sol-address',
  blockchain: 'solana',
  confirmed_balance: amount,
  currency: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    type: 'token',
    asset_path: `solana/token/${mint}`,
    detail: { contract: mint },
  },
});

describe('solana-price-enricher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the input array as-is when items is empty', async () => {
    const out = await enrich([], { network: { blockchain: 'solana' } });
    expect(out).toEqual([]);
    expect(jupiterService.getQuotes).not.toHaveBeenCalled();
  });

  it('attaches price + usdBalance + 24h change to native SOL via SOL_ADDRESS', async () => {
    const quotes = new Map([[SOL_ADDRESS, { usdPrice: 80, priceChange24h: -1.5 }]]);
    jupiterService.getQuotes.mockResolvedValue(quotes);

    const items = [buildSolItem('1000000000')]; // 1 SOL
    const out = await enrich(items, { network: { blockchain: 'solana' } });

    expect(jupiterService.getQuotes).toHaveBeenCalledWith([SOL_ADDRESS], {
      network: { blockchain: 'solana' },
    });
    expect(out[0]).toMatchObject({
      _price: 80,
      _usdBalance: 80, // 1 SOL × 80
      _priceChange24h: -1.5,
    });
  });

  it('attaches pricing to SPL tokens by contract mint', async () => {
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const quotes = new Map([[usdcMint, { usdPrice: 1.0, priceChange24h: 0.01 }]]);
    jupiterService.getQuotes.mockResolvedValue(quotes);

    const items = [buildSplItem(usdcMint, '5000000')]; // 5 USDC
    const out = await enrich(items, { network: { blockchain: 'solana' } });

    expect(out[0]).toMatchObject({
      _price: 1.0,
      _usdBalance: 5,
      _priceChange24h: 0.01,
    });
  });

  it('falls back to asset_path third segment when contract is missing', async () => {
    const fallbackMint = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
    const quotes = new Map([[fallbackMint, { usdPrice: 2, priceChange24h: null }]]);
    jupiterService.getQuotes.mockResolvedValue(quotes);

    const items = [
      {
        owner: 'sol',
        blockchain: 'solana',
        confirmed_balance: '1000000',
        currency: {
          symbol: 'X',
          name: 'X',
          decimals: 6,
          type: 'token',
          asset_path: `solana/token/${fallbackMint}`,
        },
      },
    ];
    const out = await enrich(items, { network: { blockchain: 'solana' } });

    expect(out[0]._price).toBe(2);
    expect(out[0]._usdBalance).toBe(2); // 1 unit × 2
    expect(out[0]._priceChange24h).toBeNull();
  });

  it('passes through items when Jupiter returns no quote for that mint', async () => {
    jupiterService.getQuotes.mockResolvedValue(new Map());

    const items = [buildSplItem('SomeUnpricedMint111111111111111111111111111', '1')];
    const out = await enrich(items, { network: { blockchain: 'solana' } });

    expect(out[0]).not.toHaveProperty('_price');
    expect(out[0]).not.toHaveProperty('_usdBalance');
    expect(out[0]).not.toHaveProperty('_priceChange24h');
  });

  it('passes through items when Jupiter returns an empty Map', async () => {
    jupiterService.getQuotes.mockResolvedValue(new Map());

    const items = [buildSolItem('1000000000')];
    const out = await enrich(items, { network: { blockchain: 'solana' } });

    expect(out).toBe(items);
  });

  it('deduplicates mints before calling Jupiter', async () => {
    jupiterService.getQuotes.mockResolvedValue(new Map());
    const sameMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    const items = [buildSplItem(sameMint, '1'), buildSplItem(sameMint, '2')];
    await enrich(items, { network: { blockchain: 'solana' } });

    expect(jupiterService.getQuotes).toHaveBeenCalledWith([sameMint], expect.any(Object));
  });

  it('zero-balance items resolve usdBalance to 0', async () => {
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    jupiterService.getQuotes.mockResolvedValue(
      new Map([[usdcMint, { usdPrice: 1.0, priceChange24h: 0 }]])
    );

    const items = [buildSplItem(usdcMint, '0')];
    const out = await enrich(items, { network: { blockchain: 'solana' } });

    expect(out[0]._usdBalance).toBe(0);
    expect(out[0]._price).toBe(1.0);
  });
});
