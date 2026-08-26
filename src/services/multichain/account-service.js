'use strict';

/**
 * Multichain account service.
 *
 * Resolves a per-chain `BalanceProvider` from
 * `./balance-providers/index.js`, delegates the call, and then runs
 * the matching `PriceEnricher` from `./price-enrichers/index.js` over
 * the items so each one carries `_price`, `_usdBalance`,
 * `_priceChange24h` markers (forwarded by the shared
 * `account-balance-resource` decorator). Both plug-points fall back to
 * a no-op for unknown chains so the orchestration stays uniform.
 */

const balanceProviders = require('./balance-providers');
const priceEnrichers = require('./price-enrichers');

/**
 * Fetches and price-enriches balance items for `address` on the chain
 * given by `locals.network.blockchain`. Resolves the chain's
 * `BalanceProvider` and `PriceEnricher` (both default to a uniform
 * pass-through for unregistered chains), so callers never branch on
 * blockchain identity.
 *
 * @param {string} address - account address to query.
 * @param {any} tokens - forwarded to the resolved `BalanceProvider`
 *   (provider-specific; unused by the Blockdaemon default).
 * @param {{network: {blockchain: string, environment: string}}} locals
 *   - per-request locals used to resolve both plug-points.
 * @returns {Promise<Array<Object>>} balance items, priced when a quote
 *   is available.
 */
const getBalance = async (address, tokens, locals) => {
  const { blockchain } = locals.network;
  const provider = balanceProviders.resolveProvider(blockchain);
  const items = await provider.getBalance(address, tokens, locals);
  const enricher = priceEnrichers.resolveEnricher(blockchain);
  return enricher.enrich(items, locals);
};

module.exports = { getBalance };
