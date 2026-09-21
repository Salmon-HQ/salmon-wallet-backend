'use strict';

/**
 * Curated Solana token catalog: CoinGecko's Solana token list joined with
 * its coin ids, held as a 24 h snapshot (Redis, per CoinGecko's caching
 * terms) with an in-memory search index per process.
 *
 * Tags are two-level: `verified` for the top market-cap tier (the ranked
 * top-1000 Solana coins), `community` for every other listed token; unlisted
 * mints carry no tag. The list is ordered by market-cap rank
 * (top Solana coins first, the rest alphabetically) so a client that keeps
 * the first entry per symbol keeps the real token, not a look-alike. Search
 * covers symbol, name and mint of listed tokens only; unlisted mints are
 * reached by address through `token-metadata-service` (composed in
 * `solana-ft-service`).
 */

const coingecko = require('../shared/coingecko-service');
const { getCacheKey, withSingleFlight } = require('../../infrastructure/cache/cache-helper');

const MAX_SEARCH_RESULTS = 50;
const SNAPSHOT_KEY = 'solana_ft_catalog_snapshot';
const SNAPSHOT_TTL_SECONDS = 24 * 60 * 60;
const SNAPSHOT_STALE_TTL_SECONDS = 48 * 60 * 60;
const REBUILD_LOCK_MS = 30000;

let snapshot = null; // { builtAt, tokens, byMint }

const UNRANKED = Number.MAX_SAFE_INTEGER;

/** Listed AND in the market-cap top tier → `verified`; listed only → `community`. */
const tagsFor = (rank) => (rank === UNRANKED ? ['community'] : ['verified']);

const toToken = (entry, coinIds, ranks) => {
  const coingeckoId = coinIds.get(entry.address) || null;
  const rank = (coingeckoId && ranks.get(coingeckoId)) || UNRANKED;
  return {
    id: entry.address,
    symbol: entry.symbol,
    name: entry.name,
    decimals: entry.decimals,
    icon: toLargeLogo(entry.logoURI),
    tags: tagsFor(rank),
    coingeckoId,
    rank,
  };
};

/**
 * CoinGecko's token list carries the 25×25 `thumb` logo; the wallet renders
 * logos at 44–76pt on 3× screens, so ask its CDN for `large` instead.
 * Other hosts are left alone.
 */
const toLargeLogo = (url) => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'assets.coingecko.com') return url;
    parsed.pathname = parsed.pathname.replace(/\/(thumb|small)\//, '/large/');
    return parsed.toString();
  } catch {
    return url;
  }
};

const byRankThenSymbol = (a, b) =>
  a.rank - b.rank || (a.symbol || '').localeCompare(b.symbol || '');

const isFresh = (snap) => snap && Date.now() - snap.builtAt < 5 * 60 * 1000;

const buildTokens = async () => {
  const [list, coinIds, ranks] = await Promise.all([
    coingecko.getSolanaTokenList(),
    coingecko.getSolanaCoinIds(),
    // Not swallowed: with no ranks `tagsFor` labels every listed token
    // `community`, and both the balance and activity spam filters read a
    // missing `verified` tag as a spam verdict — so a rank-less build cached
    // for 24h shows a holder nothing but native SOL while their funds sit
    // untouched on chain. Letting it throw hands `withSingleFlight` the
    // failure it already handles correctly: serve the last good snapshot,
    // and error only when no copy exists.
    coingecko.getSolanaMarketRanks(),
  ]);
  return list
    .filter((entry) => entry && entry.address && entry.symbol && typeof entry.decimals === 'number')
    .map((entry) => toToken(entry, coinIds, ranks))
    .sort(byRankThenSymbol);
};

/**
 * Catalog snapshot: memoised 5 minutes per process, held 24 h in Redis
 * (48 h stale copy) and rebuilt single-flight so many containers expiring
 * at once trigger one rebuild while the others serve the previous tokens —
 * also when the provider's circuit is open. Throws when the sources are
 * down and no copy exists — never an empty catalog.
 *
 * @param {Object} [locals] - bounds the wait for a rebuild in flight.
 */
const getSnapshot = async (locals) => {
  if (isFresh(snapshot)) {
    return snapshot;
  }
  const tokens = await withSingleFlight(getCacheKey(SNAPSHOT_KEY), {
    ttl: SNAPSHOT_TTL_SECONDS,
    staleTtl: SNAPSHOT_STALE_TTL_SECONDS,
    lockMs: REBUILD_LOCK_MS,
    rebuild: buildTokens,
    locals,
  });
  snapshot = { builtAt: Date.now(), tokens, byMint: new Map(tokens.map((t) => [t.id, t])) };
  return snapshot;
};

/** @returns {Promise<Object[]>} every listed token (verified + community), canonical shape, ranked first. */
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
