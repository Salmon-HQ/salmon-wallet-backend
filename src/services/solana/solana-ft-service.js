'use strict';

/**
 * Solana fungible-token service.
 *
 * Two-tier caching:
 *   - In-memory `tokenListCache` (1h TTL) for the full per-environment token
 *     list returned by `list()`. Concurrent loads share a single inflight
 *     promise via `pendingTokenLoads`.
 *   - Repository-backed cache for `getVerified()` — survives process restarts
 *     and feeds the curated catalog.
 *
 * Token list source is environment-dependent: the CoinGecko catalog for mainnet,
 * SPL Token Registry fallback for devnet/testnet. All results are filtered
 * to fungible tokens (decimals > 0).
 */

const { TokenListProvider } = require('@solana/spl-token-registry');
const repository = require('../../repositories/solana/solana-ft-repository');
const catalog = require('./token-catalog-service');
const metadata = require('./token-metadata-service');
const { isValidSolanaAddress } = require('../../utils/solana-address');
const { SOL_ADDRESS } = require('../../constants/solana-constants');

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
 * Fetch the raw per-environment token list from its source. The catalog
 * only covers mainnet, so devnet/testnet fall back to the SPL Token
 * Registry (`@solana/spl-token-registry`) filtered by cluster slug.
 * @param {Object} locals - Reads `network.environment`.
 * @returns {Promise<Object[]>} Unfiltered token list from the source.
 */
const getTokenList = async (locals) => {
  const { environment } = locals.network;

  // The curated catalog only covers mainnet
  if (environment === 'mainnet') {
    return catalog.getVerified();
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

    // The bare-RPC history reader looks tokens up by `address` and reads
    // `logoURI`; the catalog names them `id` / `icon`.
    const tokens = solanaTokens
      .filter((token) => token && token.name)
      .map((token) => ({
        ...token,
        address: token.address || token.id,
        logoURI: token.logoURI || token.icon,
      }));

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

/** Listed entry (tags, coingeckoId) over on-chain metadata (program, freshest decimals). */
const merge = (listed, onChain) => {
  if (!listed && !onChain) return null;
  // The catalog lists the SOL mint as "Wrapped SOL"/WSOL; the wallet shows
  // native SOL, so the native constant's symbol/name win for that mint.
  const isNativeSol = (listed || onChain).id === SOL_ADDRESS;
  return {
    ...(onChain || {}),
    ...(listed || {}),
    ...(isNativeSol && onChain ? { symbol: onChain.symbol, name: onChain.name } : {}),
    icon: listed?.icon || onChain?.icon || null,
    tags: listed ? listed.tags : [],
    coingeckoId: listed?.coingeckoId ?? null,
    tokenProgram: onChain?.tokenProgram ?? null,
  };
};

/**
 * Resolve token metadata for a batch of mints: on-chain description (DAS)
 * for every mint, catalog fields for the listed ones.
 * @param {string[]} mintAddresses
 * @param {Object} locals
 * @returns {Promise<Array<Object>>} Fungible tokens only, in canonical shape.
 */
const getByMints = async (mintAddresses, locals) => {
  const mints = [...new Set(mintAddresses)].filter(Boolean);
  const [onChain, listed] = await Promise.all([
    metadata.getByMints(mints, locals),
    catalog.byMints(mints),
  ]);
  const tokens = mints.map((mint) => merge(listed.get(mint), onChain.get(mint))).filter(Boolean);
  return filterFungibleTokens(tokens);
};

/**
 * Return the verified-token list: the curated catalog as-is (≈7k entries;
 * on-chain decoration is left to `search`/`getByMints`, where it costs one
 * DAS call for a handful of mints instead of seven for the whole list).
 * Repository-cached (5 min); the catalog itself is a 24 h snapshot.
 *
 * @param {Object} locals
 * @returns {Promise<Array<Object>>} Fungible tokens only.
 */
const getVerified = async (locals) => {
  const cached = await repository.getVerifiedTokens(locals);
  // An empty cached array is treated as a miss on purpose: it can only come
  // from a bad upstream response, and honouring it would serve an empty token
  // catalog — a token list with nothing in it — until the TTL expired.
  if (cached && cached.length > 0) {
    return filterFungibleTokens(cached);
  }

  const tokens = await catalog.getVerified();
  if (tokens.length > 0) {
    await repository.saveVerifiedTokens(tokens, locals);
  }
  return filterFungibleTokens(tokens);
};

/**
 * Free-text token search over the catalog; a bare mint address that is not
 * listed resolves on-chain so any token stays reachable by address.
 * @param {string} query
 * @param {Object} locals
 * @returns {Promise<Array<Object>>} Fungible tokens only.
 */
const search = async (query, locals) => {
  const listed = await catalog.search(query);
  if (listed.length > 0) {
    const onChain = await metadata.getByMints(
      listed.map((t) => t.id),
      locals
    );
    return filterFungibleTokens(listed.map((token) => merge(token, onChain.get(token.id))));
  }
  const candidate = String(query || '').trim();
  if (!isValidSolanaAddress(candidate)) {
    return [];
  }
  const onChain = await metadata.getByMints([candidate], locals);
  return filterFungibleTokens([merge(null, onChain.get(candidate))].filter(Boolean));
};

module.exports = {
  list,
  clearListCache,
  getByMints,
  getVerified,
  search,
  MAX_MINTS_PER_QUERY: metadata.MAX_IDS_PER_BATCH,
};
