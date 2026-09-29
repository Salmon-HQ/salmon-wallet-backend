'use strict';

const decorateBalance = require('../account-balance-resource');

describe('account-balance-resource', () => {
  it('decorates native bitcoin balances with canonical address and coingecko id', async () => {
    const balance = {
      owner: 'btc-address',
      blockchain: 'bitcoin',
      confirmed_balance: '100000000',
      currency: {
        symbol: 'BTC',
        name: 'Bitcoin',
        decimals: 8,
        type: 'native',
        asset_path: 'bitcoin/native/btc',
      },
    };

    const result = await decorateBalance(balance, {}, undefined, { locals: {} });

    expect(result).toEqual({
      owner: 'btc-address',
      blockchain: 'bitcoin',
      amount: '100000000',
      decimals: 8,
      symbol: 'BTC',
      name: 'Bitcoin',
      type: 'native',
      address: 'btc',
      coingeckoId: 'bitcoin',
    });
  });

  it('decorates native solana balances with the shared SOL address', async () => {
    const balance = {
      owner: 'sol-address',
      blockchain: 'solana',
      confirmed_balance: '123',
      currency: {
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        type: 'native',
        asset_path: 'solana/native/sol',
      },
    };

    const result = await decorateBalance(balance, {}, undefined, { locals: {} });

    expect(result.address).toBe('So11111111111111111111111111111111111111112');
    expect(result.coingeckoId).toBe('solana');
  });

  it('uses contract metadata for token balances', async () => {
    const balance = {
      owner: 'sol-address',
      blockchain: 'solana',
      confirmed_balance: '42',
      currency: {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        type: 'token',
        asset_path: 'solana/token/fallback-mint',
        detail: {
          contract: 'mint-from-detail',
        },
      },
    };

    const result = await decorateBalance(balance, {}, undefined, { locals: {} });

    expect(result).toEqual(
      expect.objectContaining({
        amount: '42',
        symbol: 'USDC',
        type: 'token',
        mint: 'mint-from-detail',
        address: 'mint-from-detail',
      })
    );
  });

  it('forwards price-enricher markers as price/usdBalance/priceChange24h', async () => {
    const balance = {
      owner: 'sol-address',
      blockchain: 'solana',
      confirmed_balance: '1000000000',
      currency: {
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        type: 'native',
        asset_path: 'solana/native/sol',
      },
      _price: 80,
      _usdBalance: 80,
      _priceChange24h: -1.5,
    };

    const result = await decorateBalance(balance, {}, undefined, { locals: {} });

    expect(result.price).toBe(80);
    expect(result.usdBalance).toBe(80);
    expect(result.priceChange24h).toBe(-1.5);
  });

  it('omits price keys when the enricher did not attach markers', async () => {
    const balance = {
      owner: 'sol-address',
      blockchain: 'solana',
      confirmed_balance: '1000000000',
      currency: {
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        type: 'native',
        asset_path: 'solana/native/sol',
      },
    };

    const result = await decorateBalance(balance, {}, undefined, { locals: {} });

    expect(result).not.toHaveProperty('price');
    expect(result).not.toHaveProperty('usdBalance');
    expect(result).not.toHaveProperty('priceChange24h');
  });

  it('forwards a null priceChange24h verbatim (not omitted)', async () => {
    const balance = {
      owner: 'btc-address',
      blockchain: 'bitcoin',
      confirmed_balance: '100000000',
      currency: {
        symbol: 'BTC',
        name: 'Bitcoin',
        decimals: 8,
        type: 'native',
        asset_path: 'bitcoin/native/btc',
      },
      _price: 50000,
      _usdBalance: 50000,
      _priceChange24h: null,
    };

    const result = await decorateBalance(balance, {}, undefined, { locals: {} });

    expect(result.priceChange24h).toBeNull();
  });

  describe('uiAmount', () => {
    const scaledToken = (overrides = {}) => ({
      owner: 'sol-address',
      blockchain: 'solana',
      confirmed_balance: '677400755573',
      currency: {
        symbol: 'AAPLx',
        name: 'Apple xStock',
        decimals: 8,
        type: 'token',
        asset_path: 'solana/mint/XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
        detail: { contract: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp' },
      },
      ...overrides,
    });

    it('publishes the scaled amount beside the raw one', async () => {
      const result = await decorateBalance(
        scaledToken({ _uiAmount: '6796.15187137' }),
        {},
        undefined,
        {
          locals: {},
        }
      );

      // `amount` stays the unit transfers and fees are denominated in.
      expect(result.amount).toBe('677400755573');
      expect(result.decimals).toBe(8);
      expect(result.uiAmount).toBe('6796.15187137');
    });

    it('omits uiAmount for a mint that scales one to one', async () => {
      const result = await decorateBalance(scaledToken(), {}, undefined, { locals: {} });

      expect(result).not.toHaveProperty('uiAmount');
    });
  });
});
