'use strict';

/**
 * Curated Solana token catalog: CoinGecko's Solana token list joined with
 * its coin ids, held as a 24 h snapshot (Redis, per CoinGecko's caching
 * terms) with an in-memory search index per process.
 *
 * "Verified" means "listed here". Search covers symbol, name and mint of
 * listed tokens only; unlisted mints are reached by address through
 * `token-metadata-service` (composed in `solana-ft-service`).
 */

const coingecko = require('../shared/coingecko-service');

const MAX_SEARCH_RESULTS = 50;

let snapshot = null; // { builtAt, tokens, byMint }

const toToken = (entry, coinIds) => ({
  id: entry.address,
  symbol: entry.symbol,
  name: entry.name,
  decimals: entry.decimals,
  icon: entry.logoURI || null,
  tags: ['verified'],
  coingeckoId: coinIds.get(entry.address) || null,
});

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
  const [list, coinIds] = await Promise.all([
    coingecko.getSolanaTokenList(),
    coingecko.getSolanaCoinIds(),
  ]);
  const tokens = list
    .filter((entry) => entry && entry.address && entry.symbol && typeof entry.decimals === 'number')
    .map((entry) => toToken(entry, coinIds));
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
  if (symbol === q || token.id === q) return 0;
  if (symbol.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (symbol.includes(q) || name.includes(q)) return 3;
  return -1;
};

/**
 * Free-text search over listed tokens: exact symbol/mint first, then
 * symbol prefix, name prefix, substring. Case-insensitive.
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
    .sort((a, b) => a.score - b.score || a.token.symbol.localeCompare(b.token.symbol))
    .slice(0, MAX_SEARCH_RESULTS)
    .map(({ token }) => token);
};

/** Test/admin helper: drop the in-process snapshot. */
const clearSnapshot = () => {
  snapshot = null;
};

module.exports = { getVerified, byMint, byMints, search, clearSnapshot, MAX_SEARCH_RESULTS };
