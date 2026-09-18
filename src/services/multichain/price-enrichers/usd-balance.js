'use strict';

/**
 * Converts an item's balance into a USD value at `usdPrice`. Shared by every
 * `PriceEnricher` implementation.
 *
 * Normally that is `confirmed_balance` (smallest unit, per `currency.decimals`).
 * When the Solana provider attached `_uiAmount` — a mint whose Scaled UI Amount
 * or Interest Bearing extension makes the displayed figure differ from the
 * stored one — the USD value follows the scaled amount instead. CoinGecko
 * quotes these mints at their market price per displayed unit (one AAPLx is one
 * Apple share), so pairing that price with the raw amount would understate the
 * position by exactly the multiplier. Solana's own integration guide puts it as
 * scaled amounts with scaled prices, raw with raw — never crossed.
 *
 * @param {{currency?: {decimals?: number}, confirmed_balance?: (number|string), _uiAmount?: string}} item
 * @param {number} usdPrice - USD price of one whole unit.
 * @returns {number} USD value, or `0` when the balance is missing/non-positive.
 */
const computeUsdBalance = (item, usdPrice) => {
  const decimals = item?.currency?.decimals ?? 0;

  if (typeof item?._uiAmount === 'string') {
    const scaled = Number(item._uiAmount);
    if (Number.isFinite(scaled) && scaled > 0) return scaled * usdPrice;
    if (Number.isFinite(scaled) && scaled <= 0) return 0;
  }

  const raw =
    typeof item.confirmed_balance === 'string'
      ? Number(item.confirmed_balance)
      : (item.confirmed_balance ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const ui = raw / Math.pow(10, decimals);
  return ui * usdPrice;
};

module.exports = { computeUsdBalance };
