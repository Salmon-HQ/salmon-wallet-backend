'use strict';

/**
 * StealthEX currency catalogue.
 *
 * v4 identifies a currency by the pair `(symbol, network)`; v2 identified it
 * by a single ticker (`usdcsol`, `ethbase`). That ticker survives in v4 as
 * `legacy_symbol`, and it is globally unique — 1013 distinct values over the
 * 1013-currency catalogue, while `symbol` alone collapses to 791. So the
 * public contract keeps speaking legacy symbols and this module translates in
 * both directions, which is what lets the migration happen without the wallet
 * changing a line.
 *
 * The catalogue is paginated (250 per page, ~1000 records) and moves far more
 * slowly than rates, so it is fetched once and cached.
 */

const cache = require('../../repositories/shared/bridge-repository');
const { request } = require('../../infrastructure/stealthex-client');

const CATALOGUE_PAGE_SIZE = 250;
// Enough pages for the current ~1000 records with room to grow; the loop stops
// as soon as a page comes back short, so this is only a runaway guard.
const MAX_CATALOGUE_PAGES = 20;

/**
 * v4 `network` → the chain id our API speaks.
 *
 * `mainnet` is deliberately absent: it is not a chain but v4's marker for "the
 * native currency of its own blockchain", and it covers roughly a hundred
 * currencies (ada, ltc, xmr, doge…). Mapping it to a chain would admit the
 * entire altcoin universe, so under `mainnet` the symbol decides — see
 * `NATIVE_SYMBOL_TO_CHAIN`.
 *
 * `brc` (Ordinals / BRC-20) is also absent on purpose: those payouts are not
 * spendable by an ordinary Bitcoin account, so offering them as a Bitcoin
 * destination would be a trap.
 */
const NETWORK_TO_CHAIN = {
  sol: 'solana',
  eth: 'ethereum',
  base: 'ethereum',
};

/** Native currencies, matched only when the network is `mainnet`. */
const NATIVE_SYMBOL_TO_CHAIN = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
};

/** v4's marker for a currency native to its own blockchain. */
const NATIVE_NETWORK = 'mainnet';

const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : '');

/** Key for the `(symbol, network)` → legacy-symbol direction. */
const pairKey = (symbol, network) => `${lower(symbol)}|${lower(network)}`;

/**
 * Resolves a currency to one of the chains this API serves.
 *
 * Upstream casing is inconsistent — both `base` and `BASE` appear as literal
 * network values — so every comparison lowercases first.
 *
 * @param {{symbol?: string, network?: string}} currency
 * @returns {'bitcoin'|'ethereum'|'solana'|null}
 */
const resolveChain = (currency) => {
  const network = lower(currency?.network);
  const symbol = lower(currency?.symbol);

  if (network === NATIVE_NETWORK) {
    return NATIVE_SYMBOL_TO_CHAIN[symbol] || null;
  }

  return NETWORK_TO_CHAIN[network] || null;
};

/**
 * The `network` value our public contract emits.
 *
 * Natives keep reporting `null`, as they did under v2. The wallet builds its
 * network id as `token.network ?? '<chain>-mainnet'`, so passing v4's literal
 * `"mainnet"` through would make the id the string `"mainnet"` and the review
 * screen would render "Unknown".
 *
 * @param {{network?: string}} currency
 * @returns {string|null}
 */
const publicNetwork = (currency) => {
  const network = lower(currency?.network);
  return !network || network === NATIVE_NETWORK ? null : currency.network;
};

/**
 * Fetches every catalogue page.
 * @returns {Promise<Array<Object>>}
 */
const fetchAllCurrencies = async () => {
  const currencies = [];

  for (let page = 0; page < MAX_CATALOGUE_PAGES; page += 1) {
    const batch = await request({
      url: '/v4/currencies',
      params: { limit: CATALOGUE_PAGE_SIZE, offset: page * CATALOGUE_PAGE_SIZE },
    });

    if (!Array.isArray(batch)) {
      throw new Error('Invalid response from StealthEX currencies API');
    }

    currencies.push(...batch);
    if (batch.length < CATALOGUE_PAGE_SIZE) break;
  }

  return currencies;
};

/**
 * Builds the two lookup directions from a raw catalogue.
 * @param {Array<Object>} currencies
 * @returns {{byLegacySymbol: Object, legacyByPair: Object}}
 */
const index = (currencies) => {
  const byLegacySymbol = {};
  const legacyByPair = {};

  currencies.forEach((currency) => {
    const legacySymbol = lower(currency.legacy_symbol);
    if (!legacySymbol) return;

    byLegacySymbol[legacySymbol] = currency;
    legacyByPair[pairKey(currency.symbol, currency.network)] = currency.legacy_symbol;
  });

  return { byLegacySymbol, legacyByPair };
};

// One parsed copy per warm container: the Redis round trip and the indexing
// are both wasted work when the same request path needs the catalogue twice.
let memo = null;

/**
 * The indexed catalogue, cache-first.
 * @returns {Promise<{byLegacySymbol: Object, legacyByPair: Object}>}
 */
const getCatalogue = async () => {
  if (memo) return memo;

  const cached = await cache.getCurrencies();
  if (cached?.length) {
    memo = index(cached);
    return memo;
  }

  const currencies = await fetchAllCurrencies();
  if (currencies.length === 0) {
    // Never cache an empty catalogue: every symbol lookup would fail for the
    // whole TTL, which reads downstream as "this pair does not exist".
    throw new Error('StealthEX returned an empty currency catalogue');
  }

  await cache.saveCurrencies(currencies);
  memo = index(currencies);
  return memo;
};

/**
 * Translates a public (legacy) symbol into the v4 `(symbol, network)` pair.
 *
 * `networkHint` is what the wallet sends as `networkIn`/`networkOut`. It is a
 * chain hint rather than a v4 network — the wallet emits `'sol' | 'btc' |
 * 'eth' | 'base'`, and three of those mean a chain, not a network — so it is
 * only used to break ties when the legacy symbol itself does not resolve.
 *
 * @param {string} legacySymbol
 * @param {string} [networkHint]
 * @returns {Promise<Object|null>} the catalogue record, or null when unknown.
 */
const resolveCurrency = async (legacySymbol, networkHint) => {
  const { byLegacySymbol } = await getCatalogue();

  const direct = byLegacySymbol[lower(legacySymbol)];
  if (direct) return direct;

  if (!networkHint) return null;

  const hinted = byLegacySymbol[`${lower(legacySymbol)}${lower(networkHint)}`];
  return hinted || null;
};

/**
 * Translates a v4 `(symbol, network)` pair back into the public symbol.
 *
 * Falls back to the raw symbol when the pair is not in the catalogue, so a
 * currency added upstream between refreshes still gets a usable answer.
 *
 * @param {string} symbol
 * @param {string} network
 * @returns {Promise<string|undefined>}
 */
const toLegacySymbol = async (symbol, network) => {
  const { legacyByPair } = await getCatalogue();
  return legacyByPair[pairKey(symbol, network)] || symbol;
};

/** Drops the per-container memo. Used by tests and by cache invalidation. */
const resetCatalogue = () => {
  memo = null;
};

module.exports = {
  getCatalogue,
  resolveCurrency,
  toLegacySymbol,
  resolveChain,
  publicNetwork,
  resetCatalogue,
  NATIVE_NETWORK,
};
