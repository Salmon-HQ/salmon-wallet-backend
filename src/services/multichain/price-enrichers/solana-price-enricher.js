'use strict';

/**
 * Solana price enricher.
 *
 * Reads mints from each balance item and queries the Jupiter Price v3
 * service through `solana/jupiter-service.getQuotes` (which already
 * batches, rate-limits, and caches per-mint quotes). Items without a
 * resolvable mint or without a quote pass through untouched — clients
 * treat the absence of `price` / `usdBalance` as "no quote available".
 *
 * The enricher writes internal markers (`_price`, `_usdBalance`,
 * `_priceChange24h`) onto each item; the `account-balance-resource`
 * decorator forwards them to the public payload as `price`,
 * `usdBalance`, `priceChange24h`. Native SOL is mapped to
 * `SOL_ADDRESS` so it shares Jupiter's mint-keyed pricing surface.
 */

const jupiterService = require('../../solana/jupiter-service');
const { SOL_ADDRESS } = require('../../../constants/solana-constants');

const SOLANA_NATIVE_ASSET_PATH = 'solana/native/sol';

/**
 * Resolves the Jupiter-pricing mint key for a balance item. Native SOL
 * maps to `SOL_ADDRESS` so it shares the mint-keyed pricing surface;
 * SPL tokens use `currency.detail.contract`, falling back to parsing
 * the mint out of `currency.asset_path`.
 *
 * @param {{currency?: {type?: string, asset_path?: string, detail?: {contract?: string}}}} item
 * @returns {string|null} mint address, or `null` when it cannot be resolved.
 */
const extractMint = (item) => {
  const currency = item?.currency;
  if (!currency) return null;
  if (currency.type === 'native') {
    return currency.asset_path === SOLANA_NATIVE_ASSET_PATH ? SOL_ADDRESS : null;
  }
  return currency.detail?.contract || currency.asset_path?.split('/')?.[2] || null;
};

/**
 * Converts an item's raw `confirmed_balance` (smallest unit, per
 * `currency.decimals`) into a USD value at `usdPrice`.
 *
 * @param {{currency?: {decimals?: number}, confirmed_balance?: (number|string)}} item
 * @param {number} usdPrice - USD price of one whole unit.
 * @returns {number} USD value, or `0` when the balance is missing/non-positive.
 */
const computeUsdBalance = (item, usdPrice) => {
  const decimals = item?.currency?.decimals ?? 0;
  const raw =
    typeof item.confirmed_balance === 'string'
      ? Number(item.confirmed_balance)
      : (item.confirmed_balance ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const ui = raw / Math.pow(10, decimals);
  return ui * usdPrice;
};

/**
 * `PriceEnricher#enrich` implementation for Solana. Batches every
 * resolvable mint through `jupiterService.getQuotes` (already cached +
 * rate-limited) and decorates matching items. Items without a
 * resolvable mint or without a quote are passed through untouched.
 *
 * @param {Array<Object>} items - balance items from a `BalanceProvider`.
 * @param {Object} locals - per-request locals forwarded to `jupiterService.getQuotes`.
 * @returns {Promise<Array<Object>>} items, priced entries decorated with
 *   `_price`, `_usdBalance`, `_priceChange24h`.
 */
const enrich = async (items, locals) => {
  if (!Array.isArray(items) || items.length === 0) return items;

  const mints = [...new Set(items.map(extractMint).filter(Boolean))];
  if (mints.length === 0) return items;

  const quotes = await jupiterService.getQuotes(mints, locals);
  if (!quotes || quotes.size === 0) return items;

  return items.map((item) => {
    const mint = extractMint(item);
    if (!mint) return item;
    const quote = quotes.get(mint);
    if (!quote || quote.usdPrice == null) return item;
    return {
      ...item,
      _price: quote.usdPrice,
      _usdBalance: computeUsdBalance(item, quote.usdPrice),
      _priceChange24h: quote.priceChange24h ?? null,
    };
  });
};

module.exports = { enrich };
