'use strict';

const { decorator } = require('../../../packages/api-utils');
const transactionService = require('../../services/bitcoin/bitcoin-transaction-service');
const utxoService = require('../../services/bitcoin/bitcoin-utxo-service');
const broadcastService = require('../../services/bitcoin/bitcoin-broadcast-service');
const decorateTransaction = require('../../resources/bitcoin/bitcoin-transaction-resource');
const decorateUtxo = require('../../resources/bitcoin/bitcoin-utxo-resource');

/**
 * Lists decorated Bitcoin transactions for an address.
 *
 * @param {import('express').Request} req - Reads `params.address` and passes
 *   `req.query` through as pagination/filter options. Uses `res.locals` for network.
 * @param {import('express').Response} res - Responds 200 with the decorated
 *   transaction list resource.
 * @returns {Promise<void>}
 */
const listTransactions = async (req, res) => {
  const { address } = req.params;
  const data = await transactionService.getTransactions(address, req.query, res.locals);
  const resource = await decorator(decorateTransaction, data, { req, res });
  res.status(200).send(resource);
};

/**
 * Lists decorated UTXOs for a Bitcoin address.
 *
 * @param {import('express').Request} req - Reads `params.address` and passes
 *   `req.query` through as pagination/filter options. Uses `res.locals` for network.
 * @param {import('express').Response} res - Responds 200 with the decorated UTXO
 *   list resource.
 * @returns {Promise<void>}
 */
const listUtxo = async (req, res) => {
  const { address } = req.params;
  const data = await utxoService.getUtxo(address, req.query, res.locals);
  const resource = await decorator(decorateUtxo, data, { req, res });

  // The resource returns null for a record that cannot describe a spendable
  // output; those must not reach the client, which feeds this list straight
  // into transaction construction.
  return res.status(200).send({ ...resource, data: resource.data.filter(Boolean) });
};

/**
 * Broadcasts a signed Bitcoin transaction.
 *
 * @param {import('express').Request} req - Reads `body.tx` (required, raw signed
 *   transaction string). Uses `res.locals` for network.
 * @param {import('express').Response} res - Responds 200 with the broadcast result on
 *   success; 400 with `{ error: 'bad_request', error_description }` when `tx` is
 *   missing or not a string.
 * @returns {Promise<void>}
 */
const sendTransaction = async (req, res) => {
  const { tx } = req.body || {};
  if (!tx || typeof tx !== 'string') {
    return res.status(400).json({
      error: 'bad_request',
      error_description: 'tx body parameter is required and must be a string.',
    });
  }
  const data = await broadcastService.sendTransaction(tx, res.locals);
  return res.status(200).send(data);
};

module.exports = {
  listTransactions,
  listUtxo,
  sendTransaction,
};
