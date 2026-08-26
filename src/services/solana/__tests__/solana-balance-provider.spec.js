'use strict';

jest.mock('../../multichain/balance-providers/blockdaemon-balance-provider', () => ({
  getBalance: jest.fn(),
}));

jest.mock('../solana-ft-service', () => ({
  getByMints: jest.fn(),
}));

const blockdaemon = require('../../multichain/balance-providers/blockdaemon-balance-provider');
const tokenService = require('../solana-ft-service');
const provider = require('../solana-balance-provider');

const buildSolNative = (lamports) => ({
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

const buildSplToken = (mint, amount, currencyOverrides = {}) => ({
  owner: 'sol-address',
  blockchain: 'solana',
  confirmed_balance: amount,
  currency: {
    symbol: 'TOK',
    name: 'Generic',
    decimals: 6,
    type: 'token',
    asset_path: `solana/mint/${mint}`,
    ...currencyOverrides,
  },
});

describe('solana-balance-provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenService.getByMints.mockResolvedValue([]);
  });

  it('attaches Jupiter v2 metadata markers to SPL tokens by mint', async () => {
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    blockdaemon.getBalance.mockResolvedValue([
      buildSolNative('1'),
      buildSplToken(usdcMint, '5000000'),
    ]);
    tokenService.getByMints.mockResolvedValue([
      {
        id: usdcMint,
        symbol: 'USDC',
        name: 'USD Coin',
        icon: 'https://logo/usdc.png',
        coingeckoId: 'usd-coin',
        tags: ['verified'],
      },
    ]);

    const out = await provider.getBalance('sol-address', undefined, { includeSpam: true });

    expect(tokenService.getByMints).toHaveBeenCalledWith([usdcMint], { includeSpam: true });
    const usdc = out.find((it) => it.currency.asset_path === `solana/mint/${usdcMint}`);
    expect(usdc).toMatchObject({
      _logo: 'https://logo/usdc.png',
      _name: 'USD Coin',
      _symbol: 'USDC',
      _coingeckoId: 'usd-coin',
      _tags: ['verified'],
    });
  });

  it('passes native SOL through unchanged (no marker injection)', async () => {
    blockdaemon.getBalance.mockResolvedValue([buildSolNative('100')]);

    const out = await provider.getBalance('sol-address', undefined, { includeSpam: true });

    expect(out[0]).not.toHaveProperty('_logo');
    expect(out[0]).not.toHaveProperty('_symbol');
  });

  it('matches mints from the legacy `solana/token/` asset_path prefix too', async () => {
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    blockdaemon.getBalance.mockResolvedValue([
      {
        owner: 'sol-address',
        blockchain: 'solana',
        confirmed_balance: '5000000',
        currency: {
          symbol: 'TOK',
          name: 'Generic',
          decimals: 6,
          type: 'token',
          asset_path: `solana/token/${usdcMint}`,
        },
      },
    ]);
    tokenService.getByMints.mockResolvedValue([
      { id: usdcMint, symbol: 'USDC', name: 'USD Coin', tags: ['verified'] },
    ]);

    const out = await provider.getBalance('sol-address', undefined, { includeSpam: true });

    expect(tokenService.getByMints).toHaveBeenCalledWith([usdcMint], { includeSpam: true });
    expect(out[0]).toMatchObject({ _symbol: 'USDC', _tags: ['verified'] });
  });

  it('drops SPL tokens with confirmed_balance === "0"', async () => {
    blockdaemon.getBalance.mockResolvedValue([
      buildSolNative('1'),
      buildSplToken('zero-mint', '0'),
      buildSplToken('nonzero-mint', '42'),
    ]);
    tokenService.getByMints.mockResolvedValue([
      { id: 'nonzero-mint', symbol: 'X', name: 'X', tags: ['verified'] },
    ]);

    const out = await provider.getBalance('sol-address', undefined, { includeSpam: true });

    const tokenMints = out
      .filter((it) => it.currency?.type === 'token')
      .map((it) => it.currency.asset_path?.replace(/^solana\/(?:mint|token)\//, ''));
    expect(tokenMints).toEqual(['nonzero-mint']);
  });

  it('keeps native items even at zero balance', async () => {
    blockdaemon.getBalance.mockResolvedValue([buildSolNative('0')]);

    const out = await provider.getBalance('sol-address', undefined, { includeSpam: true });

    expect(out).toHaveLength(1);
    expect(out[0].currency.type).toBe('native');
  });

  it('drops tokens with only "unknown" tags by default (spam filter)', async () => {
    blockdaemon.getBalance.mockResolvedValue([
      buildSolNative('1'),
      buildSplToken('verified-mint', '10'),
      buildSplToken('spam-mint', '20'),
    ]);
    tokenService.getByMints.mockResolvedValue([
      { id: 'verified-mint', symbol: 'V', name: 'V', tags: ['verified'] },
      { id: 'spam-mint', symbol: 'S', name: 'S', tags: ['unknown'] },
    ]);

    const out = await provider.getBalance('sol-address', undefined, {});

    const tokenMints = out
      .filter((it) => it.currency?.type === 'token')
      .map((it) => it.currency.asset_path?.replace(/^solana\/(?:mint|token)\//, ''));
    expect(tokenMints).toEqual(['verified-mint']);
  });

  it('drops tokens with no tags at all (spam filter)', async () => {
    blockdaemon.getBalance.mockResolvedValue([buildSplToken('no-tag-mint', '10')]);
    tokenService.getByMints.mockResolvedValue([]);

    const out = await provider.getBalance('sol-address', undefined, {});

    expect(out).toHaveLength(0);
  });

  it('preserves spam tokens when locals.includeSpam is true', async () => {
    blockdaemon.getBalance.mockResolvedValue([buildSplToken('spam-mint', '20')]);
    tokenService.getByMints.mockResolvedValue([
      { id: 'spam-mint', symbol: 'S', name: 'S', tags: ['unknown'] },
    ]);

    const out = await provider.getBalance('sol-address', undefined, { includeSpam: true });

    expect(out).toHaveLength(1);
    expect(out[0]._tags).toEqual(['unknown']);
  });

  it('keeps SPL tokens when Jupiter metadata is unavailable, spam filter or not', async () => {
    // The spam filter reads `_tags`, which only exists once Jupiter metadata is
    // merged. When Jupiter is down every token looks untagged, so filtering
    // would empty the wallet: the user sees only SOL and reads it as "my
    // tokens are gone". Showing possible spam beats hiding real funds.
    blockdaemon.getBalance.mockResolvedValue([
      buildSolNative('1'),
      buildSplToken('verified-mint', '10'),
    ]);
    tokenService.getByMints.mockRejectedValue(new Error('jupiter down'));

    const out = await provider.getBalance('sol-address', undefined, {});

    expect(out.filter((it) => it.currency?.type === 'token')).toHaveLength(1);
  });

  it('still surfaces tokens when Jupiter metadata fetch throws', async () => {
    blockdaemon.getBalance.mockResolvedValue([
      buildSolNative('1'),
      buildSplToken('verified-mint', '10'),
    ]);
    tokenService.getByMints.mockRejectedValue(new Error('jupiter down'));

    // With metadata fetch failing, no tags → spam filter would drop the token.
    // Caller passes includeSpam to surface it for inspection.
    const out = await provider.getBalance('sol-address', undefined, { includeSpam: true });

    const token = out.find((it) => it.currency?.type === 'token');
    expect(token).toBeDefined();
    expect(token).not.toHaveProperty('_tags');
  });
});
