'use strict';

jest.mock('../../../infrastructure/stealthex-client', () => ({ request: jest.fn() }));
jest.mock('../../../repositories/shared/bridge-repository', () => ({
  getCurrencies: jest.fn(),
  saveCurrencies: jest.fn(),
}));

const { request } = require('../../../infrastructure/stealthex-client');
const cache = require('../../../repositories/shared/bridge-repository');
const catalogue = require('../stealthex-catalogue');

// Shapes copied from live v4 responses, not invented: the casing quirks below
// (`BASE` vs `base`) are real and are what the resolver has to survive.
const CURRENCIES = [
  { symbol: 'btc', network: 'mainnet', legacy_symbol: 'btc', name: 'Bitcoin' },
  { symbol: 'eth', network: 'mainnet', legacy_symbol: 'eth', name: 'Ethereum' },
  { symbol: 'sol', network: 'mainnet', legacy_symbol: 'sol', name: 'Solana' },
  { symbol: 'eth', network: 'base', legacy_symbol: 'ethbase', name: 'Ethereum' },
  { symbol: 'usdc', network: 'sol', legacy_symbol: 'usdcsol', name: 'USD Coin' },
  { symbol: 'usdc', network: 'eth', legacy_symbol: 'usdc', name: 'USD Coin' },
  { symbol: 'aero', network: 'BASE', legacy_symbol: 'aerobase', name: 'Aerodrome' },
  { symbol: 'ada', network: 'mainnet', legacy_symbol: 'ada', name: 'Cardano' },
  { symbol: 'cake', network: 'bsc', legacy_symbol: 'cakebsc', name: 'PancakeSwap' },
  { symbol: 'ordi', network: 'brc', legacy_symbol: 'ordi', name: 'ORDI' },
];

describe('stealthex-catalogue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    catalogue.resetCatalogue();
    cache.getCurrencies.mockResolvedValue(CURRENCIES);
  });

  describe('resolveChain', () => {
    it.each([
      ['native SOL', { symbol: 'sol', network: 'mainnet' }, 'solana'],
      ['native BTC', { symbol: 'btc', network: 'mainnet' }, 'bitcoin'],
      ['native ETH', { symbol: 'eth', network: 'mainnet' }, 'ethereum'],
      ['an SPL token', { symbol: 'usdc', network: 'sol' }, 'solana'],
      ['an ERC-20', { symbol: 'usdc', network: 'eth' }, 'ethereum'],
      ['a Base token', { symbol: 'aero', network: 'base' }, 'ethereum'],
      ['a Base token with upstream uppercase', { symbol: 'aero', network: 'BASE' }, 'ethereum'],
    ])('maps %s', (_label, currency, chain) => {
      expect(catalogue.resolveChain(currency)).toBe(chain);
    });

    it.each([
      // `mainnet` is not a chain — it means "native of its own blockchain" and
      // covers the whole altcoin universe. Only our three symbols resolve.
      ['another chain native', { symbol: 'ada', network: 'mainnet' }],
      ['a BSC token', { symbol: 'cake', network: 'bsc' }],
      ['an Ordinal, which a BTC account cannot spend', { symbol: 'ordi', network: 'brc' }],
      ['an empty record', {}],
    ])('refuses %s', (_label, currency) => {
      expect(catalogue.resolveChain(currency)).toBeNull();
    });
  });

  describe('publicNetwork', () => {
    it('reports null for a native, as v2 did', () => {
      // The wallet builds its network id as `token.network ?? '<chain>-mainnet'`,
      // so leaking v4's literal "mainnet" makes the id the string "mainnet"
      // and the review screen renders "Unknown".
      expect(catalogue.publicNetwork({ symbol: 'sol', network: 'mainnet' })).toBeNull();
    });

    it('passes a real network through unchanged', () => {
      expect(catalogue.publicNetwork({ symbol: 'eth', network: 'base' })).toBe('base');
    });
  });

  describe('resolveCurrency', () => {
    it.each([
      ['usdcsol', 'usdc', 'sol'],
      ['ethbase', 'eth', 'base'],
      ['btc', 'btc', 'mainnet'],
      ['sol', 'sol', 'mainnet'],
    ])('translates the legacy symbol %s to (%s, %s)', async (legacy, symbol, network) => {
      await expect(catalogue.resolveCurrency(legacy)).resolves.toMatchObject({ symbol, network });
    });

    it('is case-insensitive on the caller side', async () => {
      await expect(catalogue.resolveCurrency('USDCSOL')).resolves.toMatchObject({ symbol: 'usdc' });
    });

    it('returns null for a symbol nobody knows', async () => {
      await expect(catalogue.resolveCurrency('notacoin')).resolves.toBeNull();
    });

    it('falls back to the network hint only when the symbol alone misses', async () => {
      // The wallet sends chain hints ('sol', 'base'), not v4 networks.
      await expect(catalogue.resolveCurrency('aero', 'base')).resolves.toMatchObject({
        legacy_symbol: 'aerobase',
      });
    });
  });

  describe('toLegacySymbol', () => {
    it.each([
      [['usdc', 'sol'], 'usdcsol'],
      [['eth', 'base'], 'ethbase'],
      [['btc', 'mainnet'], 'btc'],
    ])('maps %s back to %s', async ([symbol, network], legacy) => {
      await expect(catalogue.toLegacySymbol(symbol, network)).resolves.toBe(legacy);
    });

    it('tolerates upstream casing', async () => {
      await expect(catalogue.toLegacySymbol('AERO', 'base')).resolves.toBe('aerobase');
    });

    it('falls back to the raw symbol for a pair added since the last refresh', async () => {
      await expect(catalogue.toLegacySymbol('newcoin', 'eth')).resolves.toBe('newcoin');
    });
  });

  describe('fetching', () => {
    it('paginates until a short page and caches the result', async () => {
      cache.getCurrencies.mockResolvedValue(null);
      const fullPage = Array.from({ length: 250 }, (_, i) => ({
        symbol: `c${i}`,
        network: 'eth',
        legacy_symbol: `c${i}`,
      }));
      request.mockResolvedValueOnce(fullPage).mockResolvedValueOnce(CURRENCIES);

      await catalogue.getCatalogue();

      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenNthCalledWith(2, {
        url: '/v4/currencies',
        params: { limit: 250, offset: 250 },
      });
      expect(cache.saveCurrencies).toHaveBeenCalledWith([...fullPage, ...CURRENCIES]);
    });

    it('refuses to cache an empty catalogue', async () => {
      cache.getCurrencies.mockResolvedValue(null);
      request.mockResolvedValue([]);

      // Caching emptiness would make every symbol unresolvable for the whole
      // TTL, which downstream reads as "this pair does not exist".
      await expect(catalogue.getCatalogue()).rejects.toThrow(/empty currency catalogue/);
      expect(cache.saveCurrencies).not.toHaveBeenCalled();
    });

    it('reuses the parsed catalogue within a warm container', async () => {
      await catalogue.getCatalogue();
      await catalogue.getCatalogue();

      expect(cache.getCurrencies).toHaveBeenCalledTimes(1);
    });
  });
});
