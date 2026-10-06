'use strict';

/**
 * Balance provider resolver.
 *
 * Maps `locals.network.blockchain` to the provider that serves
 * `getBalance`. Every chain the balance route allows
 * (`BALANCE_CHAINS` in `src/routes/multichain/account-router.js`) must be
 * registered here; an unregistered chain is a wiring bug and throws.
 *
 * To add a chain: build its provider in the chain slice (exporting
 * `getBalance(address, tokens, locals)`) and register it below.
 */

const bitcoinBalanceProvider = require('../../bitcoin/bitcoin-balance-provider');
const solanaBalanceProvider = require('../../solana/solana-balance-provider');

const PROVIDERS_BY_CHAIN = {
  bitcoin: bitcoinBalanceProvider,
  solana: solanaBalanceProvider,
  // ethereum: require('../../ethereum/ethereum-balance-provider'),
};

/**
 * @param {string} blockchain - value of `locals.network.blockchain`.
 * @returns {BalanceProvider} a `BalanceProvider`-shaped module.
 * @throws {Error} when no provider is registered for `blockchain`.
 */
const resolveProvider = (blockchain) => {
  const provider = PROVIDERS_BY_CHAIN[blockchain];
  if (!provider) throw new Error(`No balance provider registered for ${blockchain}`);
  return provider;
};

module.exports = { resolveProvider };
