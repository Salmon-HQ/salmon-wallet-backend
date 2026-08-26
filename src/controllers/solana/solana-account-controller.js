'use strict';

const { decorator } = require('../../../packages/api-utils');
const decorateTransaction = require('../../resources/solana/solana-transaction-resource');
const transactionService = require('../../services/solana/solana-transaction-service');
const { isValidSolanaAddress } = require('../../utils/solana-address');
const {
  buildCacheKey,
  isFirstPageQuery,
  withCachedTransactionHistory,
} = require('../../infrastructure/cache/transaction-history-cache');

/**
 * Lists decorated Solana transactions for an address. First-page queries are served
 * through `withCachedTransactionHistory` (see the module-level caching policy);
 * subsequent pages always hit the service directly.
 *
 * @param {import('express').Request} req - Reads `params.address` and passes
 *   `req.query` through as pagination/filter options. Uses `res.locals` for
 *   network/provider resolution.
 * @param {import('express').Response} res - Responds 200 with the decorated
 *   transaction list resource.
 * @returns {Promise<void>}
 */
const listTransactions = async (req, res) => {
  const { address } = req.params;
  if (!isValidSolanaAddress(address)) {
    return res.status(400).json({
      error: 'bad_request',
      error_description: 'address is not a valid Solana address.',
    });
  }

  const loadTransactions = async () => {
    const data = await transactionService.getTransactions(address, req.query, res.locals);
    return decorator(decorateTransaction, data, { req, res });
  };

  const resource = isFirstPageQuery(req.query)
    ? await withCachedTransactionHistory(
        buildCacheKey('solana-transactions', address, req.query, res.locals),
        loadTransactions
      )
    : await loadTransactions();

  return res.status(200).send(resource);
};

module.exports = { listTransactions };
