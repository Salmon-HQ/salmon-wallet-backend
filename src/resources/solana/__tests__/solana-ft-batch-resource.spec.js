'use strict';

const decorateBatchToken = require('../solana-ft-batch-resource');

describe('solana-ft-batch-resource', () => {
  test('maps Jupiter v2 entries (id + icon, no coingeckoId)', async () => {
    const result = await decorateBatchToken({
      id: 'JUP1mint',
      symbol: 'JUP',
      name: 'Jupiter',
      decimals: 6,
      icon: 'https://example.test/jup.png',
      tags: ['lst'],
    });

    expect(result).toEqual({
      chainId: 101,
      address: 'JUP1mint',
      symbol: 'JUP',
      name: 'Jupiter',
      decimals: 6,
      logo: 'https://example.test/jup.png',
      tags: ['lst'],
      coingeckoId: null,
    });
  });

  test('preserves top-level coingeckoId from the CDN-normalized shape', async () => {
    const result = await decorateBatchToken({
      id: 'EPjFWusdc',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      icon: null,
      tags: [],
      coingeckoId: 'usd-coin',
    });

    expect(result.coingeckoId).toBe('usd-coin');
    expect(result.address).toBe('EPjFWusdc');
    expect(result.logo).toBeNull();
  });

  test('reads coingeckoId from extensions when top-level is absent', async () => {
    const result = await decorateBatchToken({
      address: 'extMint',
      symbol: 'EXT',
      name: 'Ext Token',
      decimals: 9,
      logoURI: 'https://example.test/ext.png',
      tags: ['custom'],
      extensions: { coingeckoId: 'ext-token' },
    });

    expect(result.address).toBe('extMint');
    expect(result.logo).toBe('https://example.test/ext.png');
    expect(result.coingeckoId).toBe('ext-token');
  });

  test('falls back to null coingeckoId when neither source provides it', async () => {
    const result = await decorateBatchToken({
      id: 'plainMint',
      symbol: 'PLN',
      name: 'Plain',
      decimals: 6,
    });

    expect(result.coingeckoId).toBeNull();
    expect(result.tags).toEqual([]);
  });
});
