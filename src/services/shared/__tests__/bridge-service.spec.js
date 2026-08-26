'use strict';

jest.mock('../../../infrastructure/stealthex-client', () => ({
  request: jest.fn(),
  logError: jest.fn(),
  errorKind: jest.requireActual('../../../infrastructure/stealthex-client').errorKind,
}));
jest.mock('../../../repositories/shared/bridge-repository', () => ({
  getAvailable: jest.fn(),
  saveAvailable: jest.fn(),
  getCurrencies: jest.fn(),
  saveCurrencies: jest.fn(),
}));

const { request } = require('../../../infrastructure/stealthex-client');
const cache = require('../../../repositories/shared/bridge-repository');
const catalogue = require('../stealthex-catalogue');
const service = require('../bridge-service');

const CURRENCIES = [
  { symbol: 'btc', network: 'mainnet', legacy_symbol: 'btc', name: 'Bitcoin' },
  { symbol: 'eth', network: 'mainnet', legacy_symbol: 'eth', name: 'Ethereum' },
  { symbol: 'sol', network: 'mainnet', legacy_symbol: 'sol', name: 'Solana' },
  { symbol: 'eth', network: 'base', legacy_symbol: 'ethbase', name: 'Ethereum' },
  { symbol: 'usdc', network: 'sol', legacy_symbol: 'usdcsol', name: 'USD Coin' },
  { symbol: 'cake', network: 'bsc', legacy_symbol: 'cakebsc', name: 'PancakeSwap' },
];

const upstreamError = (status, kind, details = 'nope') =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { err: { kind, details } } },
  });

describe('bridge-service (StealthEX v4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    catalogue.resetCatalogue();
    cache.getCurrencies.mockResolvedValue(CURRENCIES);
    cache.getAvailable.mockResolvedValue(null);
  });

  describe('estimate', () => {
    it('sends the resolved route, a numeric amount, and our margin', async () => {
      request.mockResolvedValue({ estimated_amount: 3.15223236 });

      await expect(
        service.estimate({ symbolIn: 'btc', symbolOut: 'ethbase', amount: '0.1' })
      ).resolves.toEqual({ estimated_amount: 3.15223236 });

      expect(request).toHaveBeenCalledWith({
        method: 'post',
        url: '/v4/rates/estimated-amount',
        data: {
          route: {
            from: { symbol: 'btc', network: 'mainnet' },
            to: { symbol: 'eth', network: 'base' },
          },
          // Verified live: 0.4 reproduces v2's partner_fee to the last digit.
          // Omitting it hands the margin back to the user.
          additional_fee_percent: 0.4,
          amount: 0.1,
          estimation: 'direct',
          rate: 'floating',
        },
      });
    });

    it('rejects an unknown symbol before spending an upstream call', async () => {
      await expect(
        service.estimate({ symbolIn: 'notacoin', symbolOut: 'btc', amount: '1' })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'invalid_parameter' });

      expect(request).not.toHaveBeenCalled();
    });

    it('throws when the response carries no estimate', async () => {
      request.mockResolvedValue({});

      await expect(
        service.estimate({ symbolIn: 'btc', symbolOut: 'sol', amount: '1' })
      ).rejects.toThrow(/Invalid estimate response/);
    });
  });

  describe('minimal', () => {
    it('omits max_amount when upstream reports no cap', async () => {
      // v4 always sends the key and uses null for "uncapped"; v2 omitted it.
      // The contract keeps the v2 shape.
      request.mockResolvedValue({ min_amount: 0.00038827, max_amount: null });

      await expect(service.minimal({ symbolIn: 'btc', symbolOut: 'eth' })).resolves.toEqual({
        min_amount: 0.00038827,
      });
    });

    it('passes a real cap through', async () => {
      request.mockResolvedValue({ min_amount: 0.001, max_amount: 12 });

      await expect(service.minimal({ symbolIn: 'btc', symbolOut: 'eth' })).resolves.toEqual({
        min_amount: 0.001,
        max_amount: 12,
      });
    });

    it('sends no amount, but the same route, rate and margin', async () => {
      request.mockResolvedValue({ min_amount: 1 });

      await service.minimal({ symbolIn: 'sol', symbolOut: 'btc' });

      expect(request).toHaveBeenCalledWith({
        method: 'post',
        url: '/v4/rates/range',
        data: {
          route: {
            from: { symbol: 'sol', network: 'mainnet' },
            to: { symbol: 'btc', network: 'mainnet' },
          },
          additional_fee_percent: 0.4,
          estimation: 'direct',
          rate: 'floating',
        },
      });
    });
  });

  describe('available', () => {
    // Upstream sends `rates` and `features` on every route entry. These are the
    // terms our calls use, so a route carrying them is one we can quote.
    const QUOTABLE = { rates: ['fixed', 'floating'], features: ['custom_fee'] };
    const routesFor = (routes) => ({
      available_routes: routes.map((route) => ({ ...QUOTABLE, ...route })),
    });

    // `available()` now asks upstream for a range on every surviving candidate.
    // `deadRoutes` names the `(symbol, network)` pairs that should answer
    // NoExchangeRoute; everything else quotes.
    const mockUpstream = (routes, { deadRoutes = [], probeError } = {}) => {
      request.mockImplementation(async ({ url, data }) => {
        if (url !== '/v4/rates/range') return routesFor(routes);
        const key = `${data.route.to.symbol}|${data.route.to.network}`;
        if (probeError) throw probeError;
        if (deadRoutes.includes(key)) throw upstreamError(422, 'NoExchangeRoute');
        return { min_amount: 0.001, max_amount: null };
      });
    };

    it('offers only destinations on chains the wallet can hold', async () => {
      mockUpstream([
        { symbol: 'btc', network: 'mainnet' },
        { symbol: 'eth', network: 'mainnet' },
        { symbol: 'eth', network: 'base' },
        { symbol: 'cake', network: 'bsc' },
        { symbol: 'usdc', network: 'sol' },
        { symbol: 'sol', network: 'mainnet' },
      ]);

      const result = await service.available({ symbol: 'sol' });

      // Bitcoin and Solana only: those are the networks enabled in
      // `network-capabilities`. Ethereum and Base are dropped even though the
      // chain resolver recognises them — bridging to a chain the wallet cannot
      // show is how a user loses sight of their funds. BSC is not ours either,
      // and the source excludes itself.
      expect(result.map((c) => c.legacy_symbol)).toEqual(['btc', 'usdcsol']);
    });

    it('asks upstream for the resolved pair, not the legacy symbol', async () => {
      mockUpstream([]);

      await service.available({ symbol: 'ethbase' });

      expect(request).toHaveBeenCalledWith({
        url: '/v4/currencies/eth/base',
        params: { include_available_routes: true },
      });
    });

    it('drops routes StealthEX will not quote with our margin', async () => {
      // Measured live: a route without `custom_fee` answers /v4/rates/range
      // with NoExchangeRoute, indistinguishable from a route that does not
      // exist. Offering it promises an estimate the next screen cannot get.
      mockUpstream([
        { symbol: 'btc', network: 'mainnet' },
        { symbol: 'usdc', network: 'sol', features: [] },
      ]);

      const result = await service.available({ symbol: 'sol' });

      expect(result.map((c) => c.legacy_symbol)).toEqual(['btc']);
    });

    it('drops routes that do not offer a floating rate', async () => {
      mockUpstream([
        { symbol: 'btc', network: 'mainnet' },
        { symbol: 'usdc', network: 'sol', rates: ['fixed'] },
      ]);

      const result = await service.available({ symbol: 'sol' });

      expect(result.map((c) => c.legacy_symbol)).toEqual(['btc']);
    });

    it('drops routes that carry no rates or features at all', async () => {
      // Fail closed: an entry missing the fields is one we cannot vouch for.
      request.mockResolvedValue({
        available_routes: [{ symbol: 'btc', network: 'mainnet' }],
      });

      await expect(service.available({ symbol: 'sol' })).resolves.toEqual([]);
    });

    it('drops a destination upstream refuses to quote', async () => {
      // The flags are not enough on their own: `pump` advertises custom_fee and
      // floating and still answers NoExchangeRoute, and `cetus` is a route the
      // desk retired without delisting. Only the quote itself catches those.
      mockUpstream(
        [
          { symbol: 'btc', network: 'mainnet' },
          { symbol: 'usdc', network: 'sol' },
        ],
        { deadRoutes: ['usdc|sol'] }
      );

      const result = await service.available({ symbol: 'sol' });

      expect(result.map((c) => c.legacy_symbol)).toEqual(['btc']);
    });

    it('probes each candidate with the terms the wallet will use', async () => {
      mockUpstream([{ symbol: 'btc', network: 'mainnet' }]);

      await service.available({ symbol: 'sol' });

      expect(request).toHaveBeenCalledWith({
        method: 'post',
        url: '/v4/rates/range',
        data: {
          route: {
            from: { symbol: 'sol', network: 'mainnet' },
            to: { symbol: 'btc', network: 'mainnet' },
          },
          additional_fee_percent: 0.4,
          estimation: 'direct',
          rate: 'floating',
        },
      });
    });

    it('keeps a destination when the probe itself fails', async () => {
      // A timeout or a 5xx says nothing about the route. Dropping on it would
      // make the wallet's destination list shrink whenever upstream wobbles.
      mockUpstream([{ symbol: 'btc', network: 'mainnet' }], {
        probeError: upstreamError(503, 'Internal'),
      });

      const result = await service.available({ symbol: 'sol' });

      expect(result.map((c) => c.legacy_symbol)).toEqual(['btc']);
    });

    it('does not cache an empty list', async () => {
      mockUpstream([{ symbol: 'cake', network: 'bsc' }]);

      await expect(service.available({ symbol: 'sol' })).resolves.toEqual([]);
      expect(cache.saveAvailable).not.toHaveBeenCalled();
    });

    it('serves a cache hit without calling upstream', async () => {
      cache.getAvailable.mockResolvedValue([{ legacy_symbol: 'btc' }]);

      await expect(service.available({ symbol: 'SOL' })).resolves.toEqual([
        { legacy_symbol: 'btc' },
      ]);
      expect(cache.getAvailable).toHaveBeenCalledWith('sol');
      expect(request).not.toHaveBeenCalled();
    });

    it('throws when the routes are missing from the response', async () => {
      request.mockResolvedValue({});

      await expect(service.available({ symbol: 'sol' })).rejects.toThrow(/Invalid response/);
    });
  });

  describe('create', () => {
    const EXCHANGE = {
      id: 'abc123',
      status: 'waiting',
      deposit: { symbol: 'btc', network: 'mainnet', address: 'bc1qdeposit' },
      withdrawal: { symbol: 'sol', network: 'mainnet', address: 'SoLpayout' },
    };

    it('sends address (not address_to), a numeric amount and the margin', async () => {
      request.mockResolvedValue(EXCHANGE);

      await service.create({
        symbolIn: 'btc',
        symbolOut: 'sol',
        amount: '0.01',
        addressTo: 'SoLpayout',
      });

      expect(request).toHaveBeenCalledWith({
        method: 'post',
        url: '/v4/exchanges',
        data: {
          route: {
            from: { symbol: 'btc', network: 'mainnet' },
            to: { symbol: 'sol', network: 'mainnet' },
          },
          address: 'SoLpayout',
          additional_fee_percent: 0.4,
          amount: 0.01,
          estimation: 'direct',
          rate: 'floating',
        },
      });
    });

    it('forwards a plausible refund address and drops an implausible one', async () => {
      request.mockResolvedValue(EXCHANGE);

      await service.create({
        symbolIn: 'btc',
        symbolOut: 'sol',
        amount: '0.01',
        addressTo: 'SoLpayout',
        refundAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      });
      expect(request.mock.calls[0][0].data.refund_address).toBe(
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
      );

      request.mockClear();
      await service.create({
        symbolIn: 'btc',
        symbolOut: 'sol',
        amount: '0.01',
        addressTo: 'SoLpayout',
        refundAddress: 'nope!',
      });
      expect(request.mock.calls[0][0].data).not.toHaveProperty('refund_address');
    });

    it('attaches the public symbol vocabulary to both sides', async () => {
      request.mockResolvedValue({
        ...EXCHANGE,
        withdrawal: { symbol: 'eth', network: 'base', address: '0xpayout' },
      });

      const result = await service.create({
        symbolIn: 'btc',
        symbolOut: 'ethbase',
        amount: '0.01',
        addressTo: '0xpayout',
      });

      expect(result.deposit.legacy_symbol).toBe('btc');
      expect(result.withdrawal.legacy_symbol).toBe('ethbase');
    });

    it('throws when the response has no id', async () => {
      request.mockResolvedValue({ status: 'waiting' });

      await expect(
        service.create({ symbolIn: 'btc', symbolOut: 'sol', amount: '0.01', addressTo: 'x' })
      ).rejects.toThrow(/Invalid exchange response/);
    });
  });

  describe('getTransaction', () => {
    it('resolves the legacy symbols for the wallet', async () => {
      request.mockResolvedValue({
        id: 'abc123',
        status: 'waiting',
        deposit: { symbol: 'usdc', network: 'sol' },
        withdrawal: { symbol: 'btc', network: 'mainnet' },
      });

      const result = await service.getTransaction({ id: 'abc123' });

      expect(request).toHaveBeenCalledWith({ url: '/v4/exchanges/abc123' });
      expect(result.deposit.legacy_symbol).toBe('usdcsol');
      expect(result.withdrawal.legacy_symbol).toBe('btc');
    });

    it.each([['NotFound'], ['NoExchange']])(
      'maps the %s kind to a 404 the wallet can act on',
      async (kind) => {
        request.mockRejectedValue(upstreamError(404, kind, 'Exchange not found'));

        await expect(service.getTransaction({ id: 'nope' })).rejects.toMatchObject({
          statusCode: 404,
          errorCode: 'exchange_not_found',
        });
      }
    );

    it('leaves other upstream failures untouched', async () => {
      const error = upstreamError(500, undefined, 'boom');
      request.mockRejectedValue(error);

      await expect(service.getTransaction({ id: 'abc' })).rejects.toBe(error);
    });
  });
});
