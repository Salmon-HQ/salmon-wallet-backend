'use strict';

/**
 * Solana balance provider.
 *
 * Wraps the default Blockdaemon Universal provider with Solana-specific
 * post-processing:
 *
 *   1. **catalog + on-chain metadata** for SPL tokens — overrides Blockdaemon's
 *      thin `currency.symbol/name` and side-loaded TrustWallet logo with
 *      richer catalog/DAS data (icon, name, symbol, coingeckoId, tags). Native
 *      SOL passes through untouched (Blockdaemon already nails it).
 *   2. **Zero-amount filter** — drops SPL token entries with
 *      `confirmed_balance === '0'` (junk dust accounts). Native items
 *      pass through even at zero balance so the wallet always shows the
 *      base asset.
 *   3. **Spam filter** — when `locals.includeSpam !== true`, drops SPL
 *      tokens that carry no `verified` tag (or that have no tags
 *      at all). Devs opt-in via `?includeSpam=true` to surface unverified
 *      tokens.
 *   4. **UI amount** — for the Token-2022 mints still standing, resolves the
 *      Scaled UI Amount / Interest Bearing multiplier and attaches `_uiAmount`.
 *      Runs last so the mint reads cost only what the wallet actually shows.
 *
 * The merged shape is still Blockdaemon-flavoured raw items; downstream
 * (`account-balance-resource`) reads internal markers `_logo`, `_name`,
 * `_symbol`, `_coingeckoId`, `_tags`, `_uiAmount` and forwards them to the
 * public payload.
 *
 * Registered in `multichain/balance-providers/index.js#PROVIDERS_BY_CHAIN`
 * for `solana`.
 */

const blockdaemonBalanceProvider = require('../multichain/balance-providers/blockdaemon-balance-provider');
const rpcBalanceProvider = require('./solana-rpc-balance-provider');
const tokenService = require('./solana-ft-service');
const uiAmountService = require('./token-ui-amount-service');

/**
 * True for failures the caller cannot act on: a transport error (timeout,
 * no response — axios sets `request` without `response`) or an upstream
 * 5xx. Upstream 4xx are the caller's input and must propagate unchanged.
 * Same heuristic as `middlewares/error-handler.js#describe`.
 */
const isUpstreamUnavailable = (error) =>
  Boolean(error?.request && !error?.response) || error?.response?.status >= 500;

/**
 * Blockdaemon first; on timeout/5xx fall back to the bare RPC. Blockdaemon
 * answers large wallets in 9–21 s against a 6 s budget, which made every
 * mainnet balance a 500. The RPC answers the same question in ~1 s. A 4xx
 * or an RPC failure propagates — never an empty balance.
 */
const fetchBalanceItems = async (address, tokens, locals) => {
  try {
    return await blockdaemonBalanceProvider.getBalance(address, tokens, locals);
  } catch (error) {
    if (!isUpstreamUnavailable(error)) throw error;
    console.warn(
      `[solana-balance-provider] Blockdaemon unavailable (${error.code || error.response?.status || error.message}), falling back to RPC`
    );
    return rpcBalanceProvider.getBalance(address, tokens, locals);
  }
};

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

/**
 * True unless the catalog tags carry `verified` (top market-cap tier).
 * `community` (listed, long tail) and unlisted mints are hidden by default;
 * `includeSpam` shows them.
 */
const isUnknownOnlyTags = (tags) => !(Array.isArray(tags) && tags.includes('verified'));

/** Index a token-metadata array by mint (`id` or `address`). */
const indexMetadataByMint = (metadata) => {
  const map = new Map();
  metadata.forEach((entry) => {
    const addr = entry.id || entry.address;
    if (addr) map.set(addr, entry);
  });
  return map;
};

/**
 * Overlay token metadata onto each balance item as internal `_logo`,
 * `_name`, `_symbol`, `_coingeckoId`, `_tags` fields. Items whose mint has
 * no metadata match (or that are not SPL tokens) pass through unchanged.
 */
const enrichWithTokenMetadata = (items, metadataByMint) => {
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

/** Drop SPL token items without the `verified` tag. Native items always pass through. */
const filterSpamTokens = (items) => {
  return items.filter((item) => {
    if (item?.currency?.type !== 'token') return true;
    return !isUnknownOnlyTags(item._tags);
  });
};

/**
 * Attach `_uiAmount` to items whose mint scales the displayed amount (Scaled UI
 * Amount, Interest Bearing — see `token-ui-amount-service`). Neither provider
 * reports it, so a rebasing token such as a tokenised equity otherwise renders
 * `amount / 10^decimals`, which is not what the holder owns.
 *
 * Runs last, on the items that survived the filters, and only for mints the
 * catalog marks `token-2022` — the two extensions exist nowhere else, so a
 * wallet of classic SPL tokens makes no request.
 *
 * A failure here is non-fatal, matching the metadata precedent above: the item
 * keeps the raw amount it has today and the miss is logged. Failing the whole
 * balance over one exotic mint would hide the wallet the user does own.
 */
const enrichWithUiAmounts = async (items, metadataByMint, locals) => {
  const holdings = [];
  for (const item of items) {
    const mint = extractTokenMint(item);
    if (!mint) continue;
    if (metadataByMint.get(mint)?.tokenProgram !== 'token-2022') continue;
    holdings.push({
      mint,
      amount: item.confirmed_balance,
      decimals: item.currency?.decimals ?? 0,
    });
  }
  if (holdings.length === 0) return items;

  let uiAmounts;
  try {
    uiAmounts = await uiAmountService.getUiAmounts(holdings, locals);
  } catch (error) {
    console.warn(
      `[solana-balance-provider] mint extension lookup failed, serving unscaled amounts: ${error.message}`
    );
    return items;
  }
  if (uiAmounts.size === 0) return items;

  return items.map((item) => {
    const mint = extractTokenMint(item);
    const uiAmount = mint ? uiAmounts.get(mint) : undefined;
    return uiAmount === undefined ? item : { ...item, _uiAmount: uiAmount };
  });
};

/**
 * Fetch Solana balances for `address` via the Blockdaemon Universal
 * provider, then enrich with catalog + on-chain metadata and apply the zero-amount
 * and spam filters described in the file header.
 *
 * Metadata enrichment failure is non-fatal: on error the raw Blockdaemon
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
  const items = await fetchBalanceItems(address, tokens, locals);

  const tokenMints = [...new Set(items.map(extractTokenMint).filter(Boolean))];

  let enriched = items;
  // The spam filter is only meaningful once catalog tags are attached. If the
  // metadata call fails, every token looks untagged and filtering would drop
  // the caller's entire SPL balance, leaving a wallet that shows only SOL —
  // a false zero the user reads as "my tokens are gone". Track the failure and
  // skip the filter instead: showing possible spam beats hiding real funds.
  let metadataAvailable = true;
  let metadataByMint = new Map();
  if (tokenMints.length > 0) {
    try {
      const metadata = await tokenService.getByMints(tokenMints, locals);
      metadataByMint = indexMetadataByMint(metadata);
      enriched = enrichWithTokenMetadata(items, metadataByMint);
    } catch (error) {
      metadataAvailable = false;
      console.warn(
        `[solana-balance-provider] token metadata enrichment failed, serving unfiltered balance: ${error.message}`
      );
    }
  }

  const nonZero = filterZeroAmountTokens(enriched);

  const visible =
    locals?.includeSpam === true || !metadataAvailable ? nonZero : filterSpamTokens(nonZero);

  return enrichWithUiAmounts(visible, metadataByMint, locals);
};

module.exports = { getBalance };
