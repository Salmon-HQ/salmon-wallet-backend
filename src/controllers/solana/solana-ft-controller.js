'use strict';

const { decorator } = require('../../../packages/api-utils');
const tokenService = require('../../services/solana/solana-ft-service');
const decorateBatchToken = require('../../resources/solana/solana-ft-batch-resource');

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

module.exports = { verified, search };
