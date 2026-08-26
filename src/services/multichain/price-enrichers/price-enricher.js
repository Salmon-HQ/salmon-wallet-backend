'use strict';

/**
 * PriceEnricher interface.
 *
 * Plug-point for per-chain price enrichers used by
 * `multichain/account-service.getBalance`. The service resolves an
 * enricher for `locals.network.blockchain` via `./index.js` and runs it
 * over the items returned by the matching `BalanceProvider` to attach
 * USD price, USD balance, and 24h price-change fields.
 *
 * Implementations MUST return the same array shape they received,
 * adding (when a quote is available) the internal markers
 * `_price`, `_usdBalance`, and `_priceChange24h` to each item. The
 * `account-balance-resource` decorator forwards those markers to the
 * public payload as `price`, `usdBalance`, `priceChange24h`.
 *
 * Default implementation is `null-price-enricher.js`, which is a
 * no-op passthrough used for chains without a dedicated enricher.
 *
 * @typedef {Object} PriceEnricher
 * @property {(items: Array<Object>, locals: Object) => Promise<Array<Object>>} enrich
 *   Attaches USD pricing to `items` (the array returned by the matching
 *   `BalanceProvider`). Must return an array of the same length/order,
 *   passing through untouched any item for which no quote is available.
 *   Never throws on missing-quote — that is a pass-through, not an error.
 */

/**
 * Thrown by a `PriceEnricher` resolver when no enricher supports the
 * requested blockchain/capability pair.
 */
class PriceEnricherNotImplementedError extends Error {
  /**
   * @param {string} blockchain - value of `locals.network.blockchain`.
   * @param {string} capability - capability name that was requested.
   */
  constructor(blockchain, capability) {
    super(`No price enricher for blockchain "${blockchain}" supports "${capability}"`);
    this.name = 'PriceEnricherNotImplementedError';
  }
}

module.exports = { PriceEnricherNotImplementedError };
