'use strict';

const { decorator } = require('../../../packages/api-utils');
const tokenService = require('../../services/solana/solana-ft-service');
const swapService = require('../../services/solana/solana-ft-swap-service');
const decorateBatchToken = require('../../resources/solana/solana-ft-batch-resource');
const decorateOrder = require('../../resources/solana/solana-swap-order-resource');
const decorateExecute = require('../../resources/solana/solana-swap-execute-resource');

const ORDER_REQUIRED_BASE = ['inputMint', 'outputMint', 'publicKey'];
const EXECUTE_REQUIRED_PARAMS = ['signedTransaction', 'requestId'];

const missingKeys = (source, keys) => keys.filter((key) => !source?.[key]);

/**
 * Requests a Jupiter Ultra swap order.
 *
 * @param {import('express').Request} req - Reads `query.inputMint`,
 *   `query.outputMint`, `query.publicKey` (all required), and one of
 *   `query.amount`/`query.uiAmount` (resolved to a raw amount via
 *   `swapService.resolveOrderAmount`). Remaining query params are passed through to
 *   `swapService.order`.
 * @param {import('express').Response} res - Responds 200 with the decorated swap-order
 *   resource; 400 with `{ error, error_description }` when required params are missing
 *   or the amount cannot be resolved; 404 with `{ error: 'route_not_found',
 *   error_description }` when Jupiter has no route.
 * @returns {Promise<void>}
 */
const order = async (req, res) => {
  const missingBase = missingKeys(req.query, ORDER_REQUIRED_BASE);
  if (missingBase.length > 0) {
    return res.status(400).json({
      error: 'missing_parameter',
      error_description: `Missing required query params: ${missingBase.join(', ')}`,
    });
  }

  const { amount, uiAmount, inputMint } = req.query;
  const resolved = await swapService.resolveOrderAmount(
    { amount, uiAmount, inputMint },
    res.locals
  );
  if (resolved.error) {
    return res.status(400).json(resolved);
  }

  const data = await swapService.order({ ...req.query, amount: resolved.amount }, res.locals);
  if (data) {
    const resource = await decorator(decorateOrder, data, { req, res });
    res.status(200).send(resource);
  } else {
    res.status(404).json({
      error: 'route_not_found',
      error_description: `No route available`,
    });
  }
};

/**
 * Executes a previously-requested Jupiter Ultra swap order.
 *
 * @param {import('express').Request} req - Reads `body.signedTransaction` and
 *   `body.requestId` (both required); the full body is passed through to
 *   `swapService.execute`.
 * @param {import('express').Response} res - Responds 200 with the decorated
 *   swap-execute resource; 400 with `{ error, error_description }` when required
 *   fields are missing; 404 with `{ error: 'execution_failed', error_description }`
 *   when execution fails.
 * @returns {Promise<void>}
 */
const execute = async (req, res) => {
  const missing = missingKeys(req.body, EXECUTE_REQUIRED_PARAMS);
  if (missing.length > 0) {
    return res.status(400).json({
      error: 'missing_parameter',
      error_description: `Missing required body fields: ${missing.join(', ')}`,
    });
  }

  const data = await swapService.execute(req.body, res.locals);
  if (data) {
    const resource = await decorator(decorateExecute, data, { req, res });
    res.status(200).send(resource);
  } else {
    res.status(404).json({
      error: 'execution_failed',
      error_description: `Transaction execution failed`,
    });
  }
};

/**
 * Get verified tokens
 * GET /verified
 *
 * Filters applied:
 * - Excludes NFTs (tokens with decimals === 0)
 *
 * @param {import('express').Request} req - Unused; the list is network-scoped via
 *   `res.locals`.
 * @param {import('express').Response} res - Responds 200 with the decorated
 *   batch-token list resource.
 * @returns {Promise<void>}
 */
const verified = async (req, res) => {
  const data = await tokenService.getVerified(res.locals);
  const resource = await decorator(decorateBatchToken, data, { req, res });
  res.status(200).send(resource);
};

/**
 * Search tokens by query
 * GET /search?query=sol
 *
 * Filters applied:
 * - Excludes NFTs (tokens with decimals === 0)
 *
 * @param {import('express').Request} req - Reads `query.query` (required search term).
 * @param {import('express').Response} res - Responds 200 with the decorated
 *   batch-token list resource; 400 with `{ error: 'missing_parameter',
 *   error_description }` when `query` is missing.
 * @returns {Promise<void>}
 */
const search = async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({
      error: 'missing_parameter',
      error_description: 'Query parameter "query" is required',
    });
  }

  const data = await tokenService.search(query, res.locals);
  const resource = await decorator(decorateBatchToken, data, { req, res });
  res.status(200).send(resource);
};

module.exports = { order, execute, verified, search };
