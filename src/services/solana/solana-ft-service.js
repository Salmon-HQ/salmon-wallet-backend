'use strict';

/**
 * Solana fungible-token service.
 *
 * Two-tier caching:
 *   - In-memory `tokenListCache` (1h TTL) for the full per-environment token
 *     list returned by `list()`. Concurrent loads share a single inflight
 *     promise via `pendingTokenLoads`.
 *   - Repository-backed cache for `getVerified()` — survives process restarts
 *     and feeds Jupiter's curated lists.
 *
 * Token list source is environment-dependent: Jupiter cache for mainnet,
 * SPL Token Registry fallback for devnet/testnet. All results are filtered
 * to fungible tokens (decimals > 0).
 */

const http = require('axios');
const { TokenListProvider } = require('@solana/spl-token-registry');
const repository = require('../../repositories/solana/solana-ft-repository');
const jupiterTokenService = require('./jupiter-token-service');
const cdnTokenListService = require('./cdn-token-list-service');

const JUPITER_TOKEN_LIST_URL = 'https://cache.jup.ag/tokens';
const TOKEN_LIST_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const tokenListCache = new Map();
const pendingTokenLoads = new Map();

const getEnvironmentKey = (locals) => locals?.network?.environment || 'mainnet';

const filterFungibleTokens = (tokens) => {
  return tokens.filter((token) => token.decimals > 0);
};

const getCachedTokens = (environment) => {
  const entry = tokenListCache.get(environment);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    tokenListCache.delete(environment);
    return null;
  }

  return entry.tokens;
};

const setCachedTokens = (environment, tokens) => {
  tokenListCache.set(environment, {
    tokens,
    expiresAt: Date.now() + TOKEN_LIST_CACHE_TTL,
  });
};

/**
 * Fetch the raw per-environment token list from its source. Jupiter's
 * cache only covers mainnet, so devnet/testnet fall back to the SPL Token
 * Registry (`@solana/spl-token-registry`) filtered by cluster slug.
 * @param {Object} locals - Reads `network.environment`.
 * @returns {Promise<Object[]>} Unfiltered token list from the source.
 */
const getTokenList = async (locals) => {
  const { environment } = locals.network;

  // Jupiter only has mainnet tokens
  if (environment === 'mainnet') {
    const { data } = await http.get(JUPITER_TOKEN_LIST_URL, { timeout: 10000 });
    return data;
  }

  // Fallback to SPL Token Registry for devnet/testnet
  const provider = new TokenListProvider();
  const tokenListContainer = await provider.resolve();
  const slug = environment === 'mainnet' ? 'mainnet-beta' : environment;
  return tokenListContainer.filterByClusterSlug(slug).getList();
};

/**
 * Return the full per-environment token list, hitting the in-memory cache
 * first and de-duplicating concurrent loads.
 * @param {Object} locals - Express `res.locals`; reads `network.environment`.
 * @returns {Promise<Array<Object>>} Tokens with `name` populated.
 */
const list = async (locals) => {
  const environment = getEnvironmentKey(locals);
  const cachedTokens = getCachedTokens(environment);
  if (cachedTokens) {
    return cachedTokens;
  }

  if (pendingTokenLoads.has(environment)) {
    return pendingTokenLoads.get(environment);
  }

  const loadPromise = (async () => {
    console.log(`Loading tokens from source for ${environment}...`);
    const startTime = Date.now();

    const solanaTokens = await getTokenList(locals);
    console.log(`Token Service: ${solanaTokens.length} solana tokens loaded`);

    // Jupiter V6 removed the indexed-route-map endpoint
    // Returning all Solana tokens instead of filtering by Jupiter routes
    const tokens = solanaTokens.filter((token) => token && token.name);

    setCachedTokens(environment, tokens);
    console.log(`Token Service cache warm for ${environment} (${Date.now() - startTime}ms)`);

    return tokens;
  })().finally(() => {
    pendingTokenLoads.delete(environment);
  });

  pendingTokenLoads.set(environment, loadPromise);

  return loadPromise;
};

/**
 * Drop both the in-memory token-list cache and any inflight loads. Test
 * helper / admin reset; production callers should not need this.
 */
const clearListCache = () => {
  tokenListCache.clear();
  pendingTokenLoads.clear();
};

/**
 * Resolve token metadata for a batch of mints via Jupiter.
 * @param {string[]} mintAddresses
 * @param {Object} locals
 * @returns {Promise<Array<Object>>} Fungible tokens only.
 */
const getByMints = async (mintAddresses, locals) => {
  const tokens = await jupiterTokenService.getTokensByMints(mintAddresses, locals);
  return filterFungibleTokens(tokens);
};

/**
 * Return the verified-token list. Repository-cached; on miss, tries
 * Jupiter Tokens v2 first and transparently falls back to the Solana Labs
 * CDN list when Jupiter is unavailable. Both upstreams are normalized to
 * the same Jupiter v2 canonical shape before persistence so cached
 * entries are provider-agnostic.
 *
 * @param {Object} locals
 * @returns {Promise<Array<Object>>} Fungible tokens only.
 */
const getVerified = async (locals) => {
  const cached = await repository.getVerifiedTokens(locals);
  // An empty cached array is treated as a miss on purpose: it can only come
  // from a bad upstream response, and honouring it would serve an empty token
  // catalog — a swap screen with nothing in it — until the TTL expired.
  if (cached && cached.length > 0) {
    console.log('Verified tokens cache hit.');
    return filterFungibleTokens(cached);
  }

  console.log('Verified tokens cache miss. Loading from Jupiter API');

  let tokens;
  try {
    tokens = await jupiterTokenService.getVerifiedTokens(locals);
  } catch (error) {
    console.warn(
      `Jupiter verified-tokens unavailable, falling back to Solana Labs CDN: ${error.message}`
    );
    tokens = await cdnTokenListService.getVerifiedTokens();
  }

  if (tokens.length > 0) {
    await repository.saveVerifiedTokens(tokens, locals);
  } else {
    console.warn('Verified token list came back empty; not caching it.');
  }

  return filterFungibleTokens(tokens);
};

/**
 * Free-text token search via Jupiter.
 * @param {string} query
 * @param {Object} locals
 * @returns {Promise<Array<Object>>} Fungible tokens only.
 */
const search = async (query, locals) => {
  const tokens = await jupiterTokenService.searchTokensByQuery(query, locals);
  return filterFungibleTokens(tokens);
};

module.exports = {
  list,
  clearListCache,
  getByMints,
  getVerified,
  search,
  MAX_MINTS_PER_QUERY: jupiterTokenService.MAX_MINTS_PER_QUERY,
};
