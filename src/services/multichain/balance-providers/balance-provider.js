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
 * Default implementation is `blockdaemon-balance-provider.js`, which
 * works for any chain Blockdaemon's Universal API supports. Chain
 * slices can register a richer provider (e.g. Alchemy/Infura for
 * Ethereum) by exporting it and registering the module path in
 * `./index.js#PROVIDERS_BY_CHAIN`.
 *
 * @typedef {Object} BalanceProvider
 * @property {(address: string, tokens: any, locals: any) => Promise<Array<Object>>} getBalance
 *   Fetches balance items for `address`. `tokens` is provider-specific
 *   (e.g. a token-filter list; unused by the Blockdaemon default).
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
