'use strict';

/**
 * Converts an item's raw `confirmed_balance` (smallest unit, per
 * `currency.decimals`) into a USD value at `usdPrice`. Shared by every
 * `PriceEnricher` implementation.
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

module.exports = { computeUsdBalance };
