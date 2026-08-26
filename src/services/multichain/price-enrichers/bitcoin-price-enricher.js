'use strict';

/**
 * Bitcoin price enricher.
 *
 * Reads the cached CoinGecko `bitcoin` quote (refreshed by the
 * `refreshPricesJob` rate-limited job) and attaches it to each
 * native-BTC balance item. The cache shape is whatever the job stored
 * via `simple/price`: `price.usd` is the USD quote and
 * `price.usd_24h_change` is the 24h percentage change.
 *
 * Items with no native BTC (e.g. token entries the upstream surfaces
 * for some accounts) pass through untouched. When the cache is cold
 * everything passes through and the client treats the missing price
 * as "no quote available".
 */

const coingeckoRepository = require('../../../repositories/shared/coingecko-repository');
const { BITCOIN } = require('../../../constants/blockchains');

const COINGECKO_BTC_ID = 'bitcoin';

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
 * `PriceEnricher#enrich` implementation for Bitcoin. Attaches the
 * cached CoinGecko BTC quote to every native-BTC item. Non-native items
 * are always passed through untouched, as is everything when the cache
 * is cold or the quote is unusable.
 *
 * @param {Array<Object>} items - balance items from a `BalanceProvider`.
 * @param {Object} _locals - unused; kept for `PriceEnricher` signature parity.
 * @returns {Promise<Array<Object>>} items, native-BTC entries decorated
 *   with `_price`, `_usdBalance`, `_priceChange24h` when a quote is available.
 */
const enrich = async (items, _locals) => {
  if (!Array.isArray(items) || items.length === 0) return items;

  const prices = await coingeckoRepository.getTokensPrices(BITCOIN);
  if (!prices) return items;

  const btc = prices.find((p) => p.id === COINGECKO_BTC_ID);
  const usdPrice = btc?.price?.usd;
  if (typeof usdPrice !== 'number' || !Number.isFinite(usdPrice)) return items;

  const priceChange24h =
    typeof btc?.price?.usd_24h_change === 'number' ? btc.price.usd_24h_change : null;

  return items.map((item) => {
    if (item?.currency?.type !== 'native') return item;
    return {
      ...item,
      _price: usdPrice,
      _usdBalance: computeUsdBalance(item, usdPrice),
      _priceChange24h: priceChange24h,
    };
  });
};

module.exports = { enrich };
