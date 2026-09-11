'use strict';

/**
 * Curated Solana token catalog: CoinGecko's Solana token list joined with
 * its coin ids, held as a 24 h snapshot (Redis, per CoinGecko's caching
 * terms) with an in-memory search index per process.
 *
 * "Verified" means "listed here". The list is ordered by market-cap rank
 * (top Solana coins first, the rest alphabetically) so a client that keeps
 * the first entry per symbol keeps the real token, not a look-alike. Search
 * covers symbol, name and mint of listed tokens only; unlisted mints are
 * reached by address through `token-metadata-service` (composed in
 * `solana-ft-service`).
 */

const coingecko = require('../shared/coingecko-service');

const MAX_SEARCH_RESULTS = 50;

let snapshot = null; // { builtAt, tokens, byMint }

const UNRANKED = Number.MAX_SAFE_INTEGER;

const toToken = (entry, coinIds, ranks) => {
  const coingeckoId = coinIds.get(entry.address) || null;
  return {
    id: entry.address,
    symbol: entry.symbol,
    name: entry.name,
    decimals: entry.decimals,
    icon: entry.logoURI || null,
    tags: ['verified'],
    coingeckoId,
    rank: (coingeckoId && ranks.get(coingeckoId)) || UNRANKED,
  };
};

const byRankThenSymbol = (a, b) =>
  a.rank - b.rank || (a.symbol || '').localeCompare(b.symbol || '');

const isFresh = (snap) => snap && Date.now() - snap.builtAt < 5 * 60 * 1000;

/**
 * Catalog snapshot, rebuilt from the (cached) CoinGecko sources at most
 * every 5 minutes per process. Throws when the sources are down and no
 * cached copy exists — never an empty catalog.
 */
const getSnapshot = async () => {
  if (isFresh(snapshot)) {
    return snapshot;
  }
  const [list, coinIds, ranks] = await Promise.all([
    coingecko.getSolanaTokenList(),
    coingecko.getSolanaCoinIds(),
    coingecko.getSolanaMarketRanks().catch((error) => {
      console.warn(
        `Token catalog: market ranks unavailable (${error.message}); alphabetical order`
      );
      return new Map();
    }),
  ]);
  const tokens = list
    .filter((entry) => entry && entry.address && entry.symbol && typeof entry.decimals === 'number')
    .map((entry) => toToken(entry, coinIds, ranks))
    .sort(byRankThenSymbol);
  snapshot = { builtAt: Date.now(), tokens, byMint: new Map(tokens.map((t) => [t.id, t])) };
  return snapshot;
};

/** @returns {Promise<Object[]>} every listed token, canonical shape. */
const getVerified = async () => (await getSnapshot()).tokens;

/** @returns {Promise<Object|null>} the listed token for `mint`, or null. */
const byMint = async (mint) => (await getSnapshot()).byMint.get(mint) || null;

/** @returns {Promise<Map<string, Object>>} listed tokens for the given mints. */
const byMints = async (mints) => {
  const { byMint: index } = await getSnapshot();
  return new Map(mints.filter((m) => index.has(m)).map((m) => [m, index.get(m)]));
};

const rank = (token, q) => {
  const symbol = (token.symbol || '').toLowerCase();
  const name = (token.name || '').toLowerCase();
  if (token.id === q) return 0;
  // The list carries look-alikes (a "USDC" cat coin next to USDC): an exact
  // symbol whose name also matches outranks an exact symbol alone.
  if (symbol === q) return name.includes(q) ? 0 : 0.5;
  if (symbol.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (symbol.includes(q) || name.includes(q)) return 3;
  return -1;
};

/**
 * Free-text search over listed tokens: exact mint, exact symbol (name match
 * first), symbol prefix, name prefix, substring. Case-insensitive.
 *
 * @param {string} query
 * @returns {Promise<Object[]>} up to MAX_SEARCH_RESULTS tokens.
 */
const search = async (query) => {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) {
    return [];
  }
  const { tokens } = await getSnapshot();
  return tokens
    .map((token) => ({ token, score: rank(token, query.trim() === token.id ? token.id : q) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || byRankThenSymbol(a.token, b.token))
    .slice(0, MAX_SEARCH_RESULTS)
    .map(({ token }) => token);
};

/** Test/admin helper: drop the in-process snapshot. */
const clearSnapshot = () => {
  snapshot = null;
};

module.exports = { getVerified, byMint, byMints, search, clearSnapshot, MAX_SEARCH_RESULTS };
