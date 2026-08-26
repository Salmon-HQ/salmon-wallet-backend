'use strict';

/**
 * Balance provider resolver.
 *
 * Maps `locals.network.blockchain` to the provider that should serve
 * `getBalance` requests. Chains that do not register a specific
 * provider fall back to the Blockdaemon Universal default (which works
 * for any chain Blockdaemon supports).
 *
 * To add a chain-specific provider:
 *
 *   1. Build the provider in the matching chain slice
 *      (e.g. `src/services/ethereum/ethereum-balance-provider.js`)
 *      that exports `getBalance(address, tokens, locals)`.
 *   2. Register the module path in `PROVIDERS_BY_CHAIN` below.
 *
 * The default chain (`*`) is always a safe fallback — keep it pointing
 * at Blockdaemon Universal until every supported chain registers its
 * own provider.
 */

const blockdaemonBalanceProvider = require('./blockdaemon-balance-provider');
const solanaBalanceProvider = require('../../solana/solana-balance-provider');

/**
 * Dispatch map from `BLOCKCHAINS` constant values to the `BalanceProvider`
 * that should serve `getBalance` for that chain. Chains absent from this
 * map use the Blockdaemon Universal default via `resolveProvider`.
 */
const PROVIDERS_BY_CHAIN = {
  // bitcoin: blockdaemonBalanceProvider, // implicit via default
  solana: solanaBalanceProvider,
  // ethereum: require('../../ethereum/ethereum-balance-provider'),
};

/**
 * Resolves the `BalanceProvider` registered for `blockchain`, falling
 * back to the Blockdaemon Universal provider when no chain-specific
 * override is registered.
 *
 * @param {string} blockchain - value of `locals.network.blockchain`.
 * @returns {BalanceProvider} a `BalanceProvider`-shaped module.
 */
const resolveProvider = (blockchain) =>
  PROVIDERS_BY_CHAIN[blockchain] || blockdaemonBalanceProvider;

module.exports = { resolveProvider };
