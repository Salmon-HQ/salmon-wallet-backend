'use strict';

jest.mock('../../../../repositories/shared/coingecko-repository', () => ({
  getTokensPrices: jest.fn(),
}));

const coingeckoRepository = require('../../../../repositories/shared/coingecko-repository');
const { enrich } = require('../bitcoin-price-enricher');

const buildBtcItem = (sats) => ({
  owner: 'btc-address',
  blockchain: 'bitcoin',
  confirmed_balance: sats,
  currency: {
    symbol: 'BTC',
    name: 'Bitcoin',
    decimals: 8,
    type: 'native',
    asset_path: 'bitcoin/native/btc',
  },
});

describe('bitcoin-price-enricher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes through when items is empty', async () => {
    const out = await enrich([], { network: { blockchain: 'bitcoin' } });
    expect(out).toEqual([]);
    expect(coingeckoRepository.getTokensPrices).not.toHaveBeenCalled();
  });

  it('attaches price + usdBalance + 24h change to native BTC from CoinGecko cache', async () => {
    coingeckoRepository.getTokensPrices.mockResolvedValue([
      { id: 'bitcoin', price: { usd: 50000, usd_24h_change: 2.5 } },
    ]);

    const items = [buildBtcItem('100000000')]; // 1 BTC
    const out = await enrich(items, { network: { blockchain: 'bitcoin' } });

    expect(out[0]).toMatchObject({
      _price: 50000,
      _usdBalance: 50000,
      _priceChange24h: 2.5,
    });
  });

  it('uses null when CoinGecko cache lacks 24h change', async () => {
    coingeckoRepository.getTokensPrices.mockResolvedValue([
      { id: 'bitcoin', price: { usd: 60000 } },
    ]);

    const items = [buildBtcItem('50000000')]; // 0.5 BTC
    const out = await enrich(items, { network: { blockchain: 'bitcoin' } });

    expect(out[0]._price).toBe(60000);
    expect(out[0]._usdBalance).toBe(30000);
    expect(out[0]._priceChange24h).toBeNull();
  });

  it('passes through when the CoinGecko cache is cold', async () => {
    coingeckoRepository.getTokensPrices.mockResolvedValue(null);

    const items = [buildBtcItem('100000000')];
    const out = await enrich(items, { network: { blockchain: 'bitcoin' } });

    expect(out).toBe(items);
  });

  it('passes through when the cache has no bitcoin entry', async () => {
    coingeckoRepository.getTokensPrices.mockResolvedValue([
      { id: 'something-else', price: { usd: 1 } },
    ]);

    const items = [buildBtcItem('100000000')];
    const out = await enrich(items, { network: { blockchain: 'bitcoin' } });

    expect(out[0]).not.toHaveProperty('_price');
  });

  it('passes through non-native items unchanged', async () => {
    coingeckoRepository.getTokensPrices.mockResolvedValue([
      { id: 'bitcoin', price: { usd: 50000, usd_24h_change: 1 } },
    ]);

    const tokenItem = {
      owner: 'btc',
      blockchain: 'bitcoin',
      confirmed_balance: '1',
      currency: {
        symbol: 'X',
        name: 'X',
        decimals: 0,
        type: 'token',
        asset_path: 'bitcoin/token/x',
      },
    };
    const out = await enrich([tokenItem], { network: { blockchain: 'bitcoin' } });

    expect(out[0]).not.toHaveProperty('_price');
  });

  it('zero-balance native item resolves usdBalance to 0', async () => {
    coingeckoRepository.getTokensPrices.mockResolvedValue([
      { id: 'bitcoin', price: { usd: 50000, usd_24h_change: 0 } },
    ]);

    const items = [buildBtcItem('0')];
    const out = await enrich(items, { network: { blockchain: 'bitcoin' } });

    expect(out[0]._usdBalance).toBe(0);
    expect(out[0]._price).toBe(50000);
  });
});
