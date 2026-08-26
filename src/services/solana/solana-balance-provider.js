'use strict';

/**
 * Solana balance provider.
 *
 * Wraps the default Blockdaemon Universal provider with Solana-specific
 * post-processing:
 *
 *   1. **Jupiter v2 metadata** for SPL tokens — overrides Blockdaemon's
 *      thin `currency.symbol/name` and side-loaded TrustWallet logo with
 *      richer Jupiter data (icon, name, symbol, coingeckoId, tags). Native
 *      SOL passes through untouched (Blockdaemon already nails it).
 *   2. **Zero-amount filter** — drops SPL token entries with
 *      `confirmed_balance === '0'` (junk dust accounts). Native items
 *      pass through even at zero balance so the wallet always shows the
 *      base asset.
 *   3. **Spam filter** — when `locals.includeSpam !== true`, drops SPL
 *      tokens that Jupiter only tags as `unknown` (or that have no tags
 *      at all). Devs opt-in via `?includeSpam=true` to surface unverified
 *      tokens.
 *
 * The merged shape is still Blockdaemon-flavoured raw items; downstream
 * (`account-balance-resource`) reads internal markers `_logo`, `_name`,
 * `_symbol`, `_coingeckoId`, `_tags` and forwards them to the public
 * payload.
 *
 * Registered in `multichain/balance-providers/index.js#PROVIDERS_BY_CHAIN`
 * for `solana`.
 */

const blockdaemonBalanceProvider = require('../multichain/balance-providers/blockdaemon-balance-provider');
const tokenService = require('./solana-ft-service');

// Blockdaemon Universal returns Solana SPL items with
// `asset_path: "solana/mint/<mint>"`. Some upstream/fixture variants use
// `solana/token/<mint>` — accept both so the metadata enrichment matches
// real responses (the mismatch was the root cause of the empty-balance
// bug where every SPL token got dropped by `filterSpamTokens` because
// `_tags` was never attached).
const SOLANA_TOKEN_ASSET_PREFIXES = ['solana/mint/', 'solana/token/'];

/**
 * Extract the SPL mint address from a Blockdaemon balance item, checking
 * `currency.detail.contract` first, then parsing the `asset_path` (accepts
 * both `solana/mint/<mint>` and `solana/token/<mint>` prefixes).
 * @returns {string|null} Mint address, or null for native SOL / unparseable items.
 */
const extractTokenMint = (item) => {
  const currency = item?.currency;
  if (!currency || currency.type !== 'token') return null;
  if (currency.detail?.contract) return currency.detail.contract;
  const path = currency.asset_path;
  if (typeof path === 'string') {
    const prefix = SOLANA_TOKEN_ASSET_PREFIXES.find((p) => path.startsWith(p));
    if (prefix) return path.slice(prefix.length);
  }
  return null;
};

/** True when a token has no Jupiter tags, or every tag is `'unknown'`. */
const isUnknownOnlyTags = (tags) => {
  if (!Array.isArray(tags) || tags.length === 0) return true;
  return tags.every((tag) => tag === 'unknown');
};

/** Index a Jupiter token-metadata array by mint (`id` or `address`). */
const indexMetadataByMint = (metadata) => {
  const map = new Map();
  metadata.forEach((entry) => {
    const addr = entry.id || entry.address;
    if (addr) map.set(addr, entry);
  });
  return map;
};

/**
 * Overlay Jupiter metadata onto each balance item as internal `_logo`,
 * `_name`, `_symbol`, `_coingeckoId`, `_tags` fields. Items whose mint has
 * no Jupiter match (or that are not SPL tokens) pass through unchanged.
 */
const enrichWithJupiterMetadata = (items, metadataByMint) => {
  return items.map((item) => {
    const mint = extractTokenMint(item);
    if (!mint) return item;
    const meta = metadataByMint.get(mint);
    if (!meta) return item;
    return {
      ...item,
      _logo: meta.icon ?? meta.logoURI ?? null,
      _name: meta.name || item.currency?.name || null,
      _symbol: meta.symbol || item.currency?.symbol || null,
      _coingeckoId: meta.coingeckoId ?? meta.extensions?.coingeckoId ?? null,
      _tags: Array.isArray(meta.tags) ? meta.tags : [],
    };
  });
};

/** Drop SPL token items with a zero (or non-finite) confirmed balance. Native items always pass through. */
const filterZeroAmountTokens = (items) => {
  return items.filter((item) => {
    if (item?.currency?.type !== 'token') return true;
    const raw =
      typeof item.confirmed_balance === 'string'
        ? Number(item.confirmed_balance)
        : (item.confirmed_balance ?? 0);
    return Number.isFinite(raw) && raw > 0;
  });
};

/** Drop SPL token items whose Jupiter tags are empty or only `'unknown'`. Native items always pass through. */
const filterSpamTokens = (items) => {
  return items.filter((item) => {
    if (item?.currency?.type !== 'token') return true;
    return !isUnknownOnlyTags(item._tags);
  });
};

/**
 * Fetch Solana balances for `address` via the Blockdaemon Universal
 * provider, then enrich with Jupiter v2 metadata and apply the zero-amount
 * and spam filters described in the file header.
 *
 * Jupiter enrichment failure is non-fatal: on error the raw Blockdaemon
 * items are used as-is (metadata fields simply stay unpopulated) rather
 * than failing the whole balance response.
 *
 * @param {string} address - Wallet base58 address.
 * @param {string[]} [tokens] - Optional token filter passed through to the
 *   underlying Blockdaemon provider.
 * @param {Object} locals - Request locals; `locals.includeSpam === true`
 *   bypasses the spam filter.
 * @returns {Promise<Object[]>} Blockdaemon-shaped balance items, decorated
 *   with `_logo`/`_name`/`_symbol`/`_coingeckoId`/`_tags` where available.
 */
const getBalance = async (address, tokens, locals) => {
  const items = await blockdaemonBalanceProvider.getBalance(address, tokens, locals);

  const tokenMints = [...new Set(items.map(extractTokenMint).filter(Boolean))];

  let enriched = items;
  // The spam filter is only meaningful once Jupiter tags are attached. If the
  // metadata call fails, every token looks untagged and filtering would drop
  // the caller's entire SPL balance, leaving a wallet that shows only SOL —
  // a false zero the user reads as "my tokens are gone". Track the failure and
  // skip the filter instead: showing possible spam beats hiding real funds.
  let metadataAvailable = true;
  if (tokenMints.length > 0) {
    try {
      const metadata = await tokenService.getByMints(tokenMints, locals);
      enriched = enrichWithJupiterMetadata(items, indexMetadataByMint(metadata));
    } catch (error) {
      metadataAvailable = false;
      console.warn(
        `[solana-balance-provider] Jupiter metadata enrichment failed, serving unfiltered balance: ${error.message}`
      );
    }
  }

  const nonZero = filterZeroAmountTokens(enriched);

  if (locals?.includeSpam === true || !metadataAvailable) {
    return nonZero;
  }

  return filterSpamTokens(nonZero);
};

module.exports = { getBalance };
