'use strict';

/**
 * BalanceProvider interface.
 *
 * Plug-point for per-chain balance providers. The multichain account
 * service resolves a provider for `locals.network.blockchain` via
 * `./index.js` and delegates the call.
 *
 * Implementations MUST return an array of items decorated with `owner`
 * and `blockchain`. The exact item shape is defined by the
 * `multichain-account-balance` API contract.
 *
 * Implementations: `services/bitcoin/bitcoin-balance-provider.js` (Esplora)
 * and `services/solana/solana-balance-provider.js` (Solana RPC). A chain
 * registers its provider in `./index.js#PROVIDERS_BY_CHAIN`.
 *
 * @typedef {Object} BalanceProvider
 * @property {(address: string, tokens: any, locals: any) => Promise<Array<Object>>} getBalance
 *   Fetches balance items for `address`. `tokens` is provider-specific
 *   (e.g. a token-filter list; unused by both current providers).
 *   `locals` carries the resolved `network` (blockchain + environment)
 *   used to build upstream URLs. Must resolve to an array — throw (do
 *   not return an error object) on upstream failure so the caller's
 *   error handling stays uniform.
 */

/**
 * Thrown by a `BalanceProvider` resolver when no provider supports the
 * requested blockchain/capability pair.
 */
class BalanceProviderNotImplementedError extends Error {
  /**
   * @param {string} blockchain - value of `locals.network.blockchain`.
   * @param {string} capability - capability name that was requested.
   */
  constructor(blockchain, capability) {
    super(`No balance provider for blockchain "${blockchain}" supports "${capability}"`);
    this.name = 'BalanceProviderNotImplementedError';
  }
}

module.exports = { BalanceProviderNotImplementedError };
