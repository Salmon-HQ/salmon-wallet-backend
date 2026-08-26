'use strict';

/**
 * Price-enricher resolver.
 *
 * Maps `locals.network.blockchain` to the enricher that should attach
 * USD pricing to balance items returned by the matching
 * `BalanceProvider`. Chains without a registered enricher fall back to
 * `null-price-enricher` (a no-op passthrough) so
 * `account-service.getBalance` never branches on chain identity.
 *
 * To add a chain-specific enricher:
 *
 *   1. Build the enricher (e.g.
 *      `./ethereum-price-enricher.js`) exporting
 *      `enrich(items, locals)`.
 *   2. Register it in `ENRICHERS_BY_CHAIN` below, keyed by the
 *      `BLOCKCHAINS` constant.
 */

const solanaPriceEnricher = require('./solana-price-enricher');
const bitcoinPriceEnricher = require('./bitcoin-price-enricher');
const nullPriceEnricher = require('./null-price-enricher');
const { BITCOIN, SOLANA } = require('../../../constants/blockchains');

/**
 * Dispatch map from `BLOCKCHAINS` constant values to the `PriceEnricher`
 * that should attach USD pricing for that chain. Chains absent from
 * this map use `nullPriceEnricher` (no-op) via `resolveEnricher`.
 */
const ENRICHERS_BY_CHAIN = {
  [SOLANA]: solanaPriceEnricher,
  [BITCOIN]: bitcoinPriceEnricher,
};

/**
 * Resolves the `PriceEnricher` registered for `blockchain`, falling
 * back to the no-op `nullPriceEnricher` when no chain-specific
 * enricher is registered.
 *
 * @param {string} blockchain - value of `locals.network.blockchain`.
 * @returns {PriceEnricher} a `PriceEnricher`-shaped module.
 */
const resolveEnricher = (blockchain) => ENRICHERS_BY_CHAIN[blockchain] || nullPriceEnricher;

module.exports = { resolveEnricher };
