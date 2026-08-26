'use strict';

/**
 * Bridge service — StealthEX API v4.
 *
 * v4 addresses a currency by the pair `(symbol, network)` where v2 used a
 * single ticker. Our public contract keeps speaking the v2 vocabulary: the
 * ticker survives upstream as `legacy_symbol`, so `stealthex-catalogue`
 * translates in both directions and the wallet needs no change. See
 * `docs/plans/2026-08-21-stealthex-v4-migration.md` for the full mapping and
 * for the evidence behind each decision.
 *
 * Two of those decisions are worth repeating here because they are easy to
 * "clean up" by mistake:
 *
 * - `additional_fee_percent: 0.4` is our margin, the exact replacement for v2's
 *   `partner_fee: '0.4'`. Verified by back-to-back live calls returning the
 *   same amount to the last digit. Omitting it silently gives the margin away.
 * - `estimation: 'direct'` and `rate: 'floating'` reproduce v2 behaviour.
 *   Fixed-rate is a real feature (it carries a ~60s `rate_id` that has to be
 *   threaded into creation and re-quoted on expiry), not a flag flip.
 *
 * `available` is cached via `bridge-repository`; rates, creation and lookup
 * always hit upstream.
 */

const cache = require('../../repositories/shared/bridge-repository');
const { request, logError, errorKind } = require('../../infrastructure/stealthex-client');
const catalogue = require('./stealthex-catalogue');

// Our margin on every exchange, sent to StealthEX as a percentage.
const PARTNER_FEE_PERCENT = 0.4;

// Input-amount-driven quoting, floating rate. Both reproduce v2 behaviour.
const ESTIMATION = 'direct';
const RATE = 'floating';

// Chains the wallet can actually hold. `network-capabilities-<stage>.js`
// enables only bitcoin and solana, so offering an Ethereum destination sends a
// user's funds to a chain their wallet does not show — which is what the
// previous filter did, because it compared upstream's lowercase networks
// against an uppercase list, matched nothing, and fell back to a hardcoded
// "featured" set containing ETH.
//
// Ethereum is a one-line addition here if it ever ships; `resolveChain` still
// recognises it, this list just does not offer it.
const SUPPORTED_CHAINS = ['solana', 'bitcoin'];

// Every quote, range and order we send carries `additional_fee_percent` (our
// margin) and `rate: 'floating'`. StealthEX does not support those on every
// route, and it does not fail politely when it cannot: a route that lacks the
// `custom_fee` feature answers `POST /v4/rates/range` with
// `{err: {kind: 'NoExchangeRoute'}}` — the same error as a route that does not
// exist at all. Dropping the fee makes the very same pair quote fine, which is
// how the cause was isolated.
//
// So `available_routes` is a catalogue of routes, not of routes *we* can sell,
// and the difference is not cosmetic: measured live on 2026-08-22, 16 of the
// 58 destinations we offered from btc were unquotable, all of them Solana
// tokens (ponke, melania, myro, gari…). The user picked one, the app asked for
// an estimate, and the estimate 404'd.
//
// The route entries already carry the answer — `rates` and `features` come
// back on every one of them, and are byte-identical to the rows of the global
// `GET /v4/currencies/available-routes` matrix (verified for btc and sol; the
// matrix is 522k rows / 68 MB / ~6 s, and adds nothing here). Filtering on
// them costs no extra call.
const REQUIRED_ROUTE_FEATURE = 'custom_fee';

// The flags are necessary but not sufficient: measured on the 42 survivors,
// two (`pump`, `cetus`) still answer `NoExchangeRoute`. `cetus` fails even with
// no fee at all — the catalogue simply still lists a route the desk has
// retired. No field on the route entry distinguishes them, so the only honest
// test is to ask for the quote the wallet is about to ask for.
//
// 42 probes run in ~2.3s at this concurrency (measured live, no rate-limiting
// observed), and only on a cache miss — the 10-minute TTL means one request per
// symbol per ten minutes pays it. The flag filter above is what keeps that
// number at 42 instead of 58.
const PROBE_CONCURRENCY = 10;

// Upstream's answers for "this pair cannot be traded". Anything else — a
// timeout, a 5xx, a rate-limit — is our problem, not a verdict on the route, so
// the destination stays in the list rather than disappearing from the wallet
// because StealthEX had a bad second.
const NO_ROUTE_KINDS = ['NoExchangeRoute', 'NoPair'];

/**
 * Whether StealthEX will quote this exact route on our terms, right now.
 *
 * @param {{from: {symbol: string, network: string}, to: {symbol: string, network: string}}} route
 * @returns {Promise<boolean>} false only when upstream says the route does not
 *   exist; true when it quotes, and true when the check itself failed.
 */
const isRouteLive = async (route) => {
  try {
    await request({
      method: 'post',
      url: '/v4/rates/range',
      data: {
        route,
        estimation: ESTIMATION,
        rate: RATE,
        additional_fee_percent: PARTNER_FEE_PERCENT,
      },
    });
    return true;
  } catch (error) {
    return !NO_ROUTE_KINDS.includes(errorKind(error));
  }
};

/**
 * Keeps only the destinations upstream will actually quote from `from`.
 *
 * @param {{symbol: string, network: string}} from
 * @param {Array<Object>} destinations - Catalogue records.
 * @returns {Promise<Array<Object>>}
 */
const keepLiveRoutes = async (from, destinations) => {
  const live = [];

  for (let i = 0; i < destinations.length; i += PROBE_CONCURRENCY) {
    const batch = destinations.slice(i, i + PROBE_CONCURRENCY);
    const results = await Promise.all(
      batch.map((to) => isRouteLive({ from, to: { symbol: to.symbol, network: to.network } }))
    );
    batch.forEach((currency, index) => {
      if (results[index]) live.push(currency);
    });
  }

  return live;
};

/**
 * Whether a route entry supports the terms every one of our calls uses.
 *
 * @param {{rates?: Array<string>, features?: Array<string>}} route
 * @returns {boolean}
 */
const isQuotable = (route) =>
  Array.isArray(route?.rates) &&
  route.rates.includes(RATE) &&
  Array.isArray(route?.features) &&
  route.features.includes(REQUIRED_ROUTE_FEATURE);

// Bare-address sanity bounds: BTC/SOL/EVM addresses all sit well inside this
// range. Only used to reject junk before forwarding to StealthEX.
const MIN_REFUND_ADDRESS_LENGTH = 20;
const MAX_REFUND_ADDRESS_LENGTH = 128;
const REFUND_ADDRESS_PATTERN = /^[a-zA-Z0-9:]+$/;

/**
 * Raised when a symbol cannot be resolved to a currency the provider knows.
 * A 400 rather than a 500: the caller named something that does not exist.
 *
 * @param {string} symbol
 * @returns {Error}
 */
const unknownSymbolError = (symbol) => {
  const error = new Error(`Unknown currency symbol: ${symbol}`);
  error.statusCode = 400;
  error.errorCode = 'invalid_parameter';
  return error;
};

/**
 * Resolves both sides of an exchange into the `route` object v4 expects.
 *
 * The network hints are the wallet's `networkIn`/`networkOut`. They describe a
 * chain, not a v4 network, so the catalogue only uses them to break ties.
 *
 * @param {{symbolIn: string, symbolOut: string, networkIn?: string, networkOut?: string}} args
 * @returns {Promise<{from: {symbol: string, network: string}, to: {symbol: string, network: string}}>}
 * @throws {Error} 400 `invalid_parameter` when either symbol is unknown.
 */
const buildRoute = async ({ symbolIn, symbolOut, networkIn, networkOut }) => {
  const [from, to] = await Promise.all([
    catalogue.resolveCurrency(symbolIn, networkIn),
    catalogue.resolveCurrency(symbolOut, networkOut),
  ]);

  if (!from) throw unknownSymbolError(symbolIn);
  if (!to) throw unknownSymbolError(symbolOut);

  return {
    from: { symbol: from.symbol, network: from.network },
    to: { symbol: to.symbol, network: to.network },
  };
};

/**
 * Currencies reachable from `symbol`, restricted to the chains the wallet can
 * hold and to the routes StealthEX will actually quote on our terms.
 *
 * @param {{symbol: string, networkIn?: string}} args
 * @returns {Promise<Array<Object>>} Catalogue records for the destinations.
 * @throws {Error} On upstream failures, or 400 when `symbol` is unknown.
 */
const available = async ({ symbol: rawSymbol, networkIn }) => {
  const symbol = String(rawSymbol).toLowerCase();

  const cached = await cache.getAvailable(symbol);
  if (cached) {
    console.log(`[StealthEX] available(${symbol}) cache hit`);
    return cached;
  }

  try {
    const source = await catalogue.resolveCurrency(symbol, networkIn);
    if (!source) throw unknownSymbolError(symbol);

    const data = await request({
      url: `/v4/currencies/${source.symbol}/${source.network}`,
      params: { include_available_routes: true },
    });

    if (!Array.isArray(data?.available_routes)) {
      console.error('[StealthEX] Invalid response from currencies endpoint:', {
        hasRoutes: Array.isArray(data?.available_routes),
      });
      throw new Error('Invalid response from StealthEX currencies API');
    }

    const { byLegacySymbol } = await catalogue.getCatalogue();
    const bySymbolNetwork = new Map(
      Object.values(byLegacySymbol).map((currency) => [
        `${currency.symbol}|${currency.network}`.toLowerCase(),
        currency,
      ])
    );

    const candidates = data.available_routes
      .filter(isQuotable)
      .map((route) => bySymbolNetwork.get(`${route.symbol}|${route.network}`.toLowerCase()))
      .filter(
        (currency) =>
          currency &&
          currency.legacy_symbol !== source.legacy_symbol &&
          SUPPORTED_CHAINS.includes(catalogue.resolveChain(currency))
      );

    const result = await keepLiveRoutes(
      { symbol: source.symbol, network: source.network },
      candidates
    );

    // Never cache an empty list: an upstream glitch or an unknown symbol would
    // otherwise freeze "this pair has no destinations" for the whole TTL.
    if (result.length > 0) {
      await cache.saveAvailable(symbol, result);
      console.log(`[StealthEX] available(${symbol}) cached`);
    }

    return result;
  } catch (error) {
    logError('available()', error, { symbol });
    throw error;
  }
};

/**
 * Estimate the receive amount for an exchange.
 *
 * @param {{symbolIn: string, symbolOut: string, amount: string|number,
 *   networkIn?: string, networkOut?: string}} args
 * @returns {Promise<{estimated_amount: number}>} Raw StealthEX response.
 * @throws {Error} On upstream failures, or when the response is missing
 *   `estimated_amount`.
 */
const estimate = async ({ symbolIn, symbolOut, amount, networkIn, networkOut }) => {
  try {
    const route = await buildRoute({ symbolIn, symbolOut, networkIn, networkOut });

    const data = await request({
      method: 'post',
      url: '/v4/rates/estimated-amount',
      data: {
        route,
        amount: Number(amount),
        estimation: ESTIMATION,
        rate: RATE,
        additional_fee_percent: PARTNER_FEE_PERCENT,
      },
    });

    if (!data || typeof data.estimated_amount === 'undefined') {
      console.error('[StealthEX] Invalid estimate response:', { data });
      throw new Error('Invalid estimate response from StealthEX API');
    }

    return { estimated_amount: data.estimated_amount };
  } catch (error) {
    logError('estimate()', error, { symbolIn, symbolOut, amount });
    throw error;
  }
};

/**
 * Exchangeable range for a pair.
 *
 * Public shape: `{min_amount, max_amount?}`. v4 always sends the `max_amount`
 * key and uses `null` for "no cap", where v2 omitted it; the key stays omitted
 * here so the contract does not change.
 *
 * @param {{symbolIn: string, symbolOut: string, networkIn?: string, networkOut?: string}} args
 * @returns {Promise<{min_amount: number, max_amount?: number}>}
 * @throws {Error} On upstream failures, or when `min_amount` is missing.
 */
const minimal = async ({ symbolIn, symbolOut, networkIn, networkOut }) => {
  try {
    const route = await buildRoute({ symbolIn, symbolOut, networkIn, networkOut });

    const data = await request({
      method: 'post',
      url: '/v4/rates/range',
      data: {
        route,
        estimation: ESTIMATION,
        rate: RATE,
        additional_fee_percent: PARTNER_FEE_PERCENT,
      },
    });

    if (!data || typeof data.min_amount === 'undefined') {
      console.error('[StealthEX] Invalid minimal response:', { data });
      throw new Error('Invalid minimal response from StealthEX API');
    }

    return data.max_amount !== undefined && data.max_amount !== null
      ? { min_amount: data.min_amount, max_amount: data.max_amount }
      : { min_amount: data.min_amount };
  } catch (error) {
    logError('minimal()', error, { symbolIn, symbolOut });
    throw error;
  }
};

/**
 * Attaches the public (legacy) symbol to both sides of an exchange.
 *
 * Done here rather than in the resource: the lookup needs the cached
 * catalogue, and a formatting layer that performs I/O is a formatting layer
 * that cannot be unit-tested without a network.
 *
 * @param {Object} exchange - Raw v4 exchange.
 * @returns {Promise<Object>} A copy with `legacy_symbol` on `deposit` and
 *   `withdrawal`.
 */
const withLegacySymbols = async (exchange) => {
  const [depositSymbol, withdrawalSymbol] = await Promise.all([
    catalogue.toLegacySymbol(exchange.deposit?.symbol, exchange.deposit?.network),
    catalogue.toLegacySymbol(exchange.withdrawal?.symbol, exchange.withdrawal?.network),
  ]);

  return {
    ...exchange,
    deposit: { ...exchange.deposit, legacy_symbol: depositSymbol },
    withdrawal: { ...exchange.withdrawal, legacy_symbol: withdrawalSymbol },
  };
};

/**
 * Normalize a client-supplied refund address.
 *
 * StealthEX documents `refund_address` as an optional String with no format
 * rules (the FROM-chain address the base currency is returned to when an
 * exchange fails), so validation here is deliberately minimal: reject
 * anything that is not a plausible bare blockchain address rather than
 * attempt per-chain parsing the gateway has no business owning.
 *
 * @param {unknown} value
 * @returns {string|null} Trimmed address, or null when absent/implausible.
 */
const normalizeRefundAddress = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < MIN_REFUND_ADDRESS_LENGTH || trimmed.length > MAX_REFUND_ADDRESS_LENGTH) {
    return null;
  }
  return REFUND_ADDRESS_PATTERN.test(trimmed) ? trimmed : null;
};

/**
 * Create an exchange order.
 *
 * @param {{symbolIn: string, symbolOut: string, amount: string|number, addressTo: string,
 *   refundAddress?: string, networkIn?: string, networkOut?: string}} args -
 *   `refundAddress` is optional: the user's address on the `symbolIn` chain,
 *   forwarded as StealthEX `refund_address` so a failed exchange refunds to
 *   the wallet instead of falling back to StealthEX's own policy. Ignored when
 *   absent or implausible.
 * @returns {Promise<Object>} Raw StealthEX exchange.
 * @throws {Error} On upstream failures, or when the response has no `id`.
 */
const create = async ({
  symbolIn,
  symbolOut,
  amount,
  addressTo,
  refundAddress,
  networkIn,
  networkOut,
}) => {
  const refund = normalizeRefundAddress(refundAddress);

  try {
    const route = await buildRoute({ symbolIn, symbolOut, networkIn, networkOut });

    console.log('[StealthEX] create() request:', {
      symbolIn,
      symbolOut,
      amount,
      addressTo: `${addressTo?.substring(0, 10)}...`,
      hasRefundAddress: Boolean(refund),
    });

    const data = await request({
      method: 'post',
      url: '/v4/exchanges',
      data: {
        route,
        amount: Number(amount),
        estimation: ESTIMATION,
        rate: RATE,
        address: addressTo,
        additional_fee_percent: PARTNER_FEE_PERCENT,
        ...(refund ? { refund_address: refund } : {}),
      },
    });

    if (!data || !data.id) {
      console.error('[StealthEX] Invalid exchange response:', { data });
      throw new Error('Invalid exchange response from StealthEX API');
    }

    return withLegacySymbols(data);
  } catch (error) {
    logError('create()', error, { symbolIn, symbolOut, amount });
    throw error;
  }
};

/**
 * Look up an existing exchange order by id.
 *
 * @param {{id: string}} args
 * @returns {Promise<Object>} Raw StealthEX exchange.
 * @throws {Error} 404 `exchange_not_found` when the provider does not know the
 *   id; otherwise the upstream failure.
 */
const getTransaction = async ({ id }) => {
  try {
    const data = await request({ url: `/v4/exchanges/${id}` });

    if (!data || !data.id) {
      console.error('[StealthEX] Invalid transaction response:', { data });
      throw new Error('Invalid transaction response from StealthEX API');
    }

    return withLegacySymbols(data);
  } catch (error) {
    logError('getTransaction()', error, { id });

    // The request is well formed — the order simply is not there — and the
    // wallet polls this route for hours per exchange, so it needs to tell
    // "unknown order" apart from "the status service is failing".
    // `NoExchange` is v2's spelling, kept while orders created on v2 can still
    // be polled.
    if (['NotFound', 'NoExchange'].includes(errorKind(error))) {
      const notFound = new Error('The exchange order was not found.');
      notFound.statusCode = 404;
      notFound.errorCode = 'exchange_not_found';
      throw notFound;
    }

    throw error;
  }
};

module.exports = { available, estimate, minimal, create, getTransaction };
