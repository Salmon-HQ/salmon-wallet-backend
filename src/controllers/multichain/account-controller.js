'use strict';

const { decorator } = require('../../../packages/api-utils');
const accountService = require('../../services/multichain/account-service');
const decorateBalance = require('../../resources/shared/account-balance-resource');
const { isValidSolanaAddress } = require('../../utils/solana-address');
const { isValidBitcoinAddress } = require('../../utils/bitcoin-address');

const ADDRESS_VALIDATORS = {
  solana: isValidSolanaAddress,
  bitcoin: isValidBitcoinAddress,
};

const isTruthyQueryFlag = (raw) => raw === 'true' || raw === '1' || raw === true;

/**
 * Returns the multichain account balance for an address, dispatching on
 * `res.locals.network.blockchain` (see `BALANCE_CHAINS` allowlist).
 *
 * @param {import('express').Request} req - Reads `params.address`, `query.tokens`
 *   (chain-specific token filter), and `query.includeSpam` (truthy string/boolean;
 *   stashed on `res.locals.includeSpam` so the resolved `BalanceProvider` can opt out
 *   of its spam filter without re-parsing the query string).
 * @param {import('express').Response} res - Responds 200 with the decorated
 *   native/token balance resource; 400 `invalid_parameter` when the address
 *   is malformed for the network's chain.
 * @returns {Promise<void>}
 */
const showBalance = async (req, res) => {
  const { address } = req.params;
  const { tokens, includeSpam } = req.query;

  const isValidAddress = ADDRESS_VALIDATORS[res.locals.network?.blockchain];
  if (isValidAddress && !isValidAddress(address)) {
    return res.status(400).json({
      error: 'invalid_parameter',
      error_description: 'The address parameter is not valid for this network.',
    });
  }

  // `includeSpam=true` opts out of the chain-specific spam filter applied
  // by the resolved BalanceProvider (e.g. Solana drops tokens with only
  // `unknown` Jupiter tags by default). Stashed on `res.locals` so the
  // provider sees a typed boolean instead of re-parsing the query string.
  res.locals.includeSpam = isTruthyQueryFlag(includeSpam);

  const data = await accountService.getBalance(address, tokens, res.locals);
  const resource = await decorator(decorateBalance, data, { req, res });
  res.status(200).send(resource);
};

module.exports = { showBalance };
