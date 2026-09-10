'use strict';

const { decorator } = require('../../../packages/api-utils');
const tokenService = require('../../services/solana/solana-ft-service');
const swapBuildService = require('../../services/solana/swap/solana-swap-build-service');
const decorateBatchToken = require('../../resources/solana/solana-ft-batch-resource');
const decorateSwapBuild = require('../../resources/solana/solana-swap-build-resource');
const { findInvalidAddressParam } = require('../../utils/solana-address');

const BUILD_REQUIRED_PARAMS = ['inputMint', 'outputMint', 'publicKey'];
const SWAP_NETWORK = 'solana-mainnet';

/**
 * Builds an UNSIGNED swap transaction for the client to sign and broadcast
 * (`solana-swap-build` contract; root AGENTS.md "Signing boundary").
 *
 * @param {import('express').Request} req - Reads `query.inputMint`, `query.outputMint`,
 *   `query.publicKey` (all required), one of `query.amount`/`query.uiAmount`, and the
 *   optional `query.slippageBps`. Fee parameters are never read from the request.
 * @param {import('express').Response} res - Responds 200 with the swap-build resource;
 *   400 `{ error, error_description }` on missing/invalid params or a non-mainnet
 *   network. 404 `no_route`, 502 `provider_fee_mismatch` and 503 `fee_account_missing`
 *   reach the error middleware from the service.
 * @returns {Promise<void>}
 */
const build = async (req, res) => {
  const missing = BUILD_REQUIRED_PARAMS.filter((key) => !req.query[key]);
  if (missing.length > 0) {
    return res.status(400).json({
      error: 'missing_parameter',
      error_description: `Missing required query params: ${missing.join(', ')}`,
    });
  }

  const { inputMint, outputMint, publicKey, amount, uiAmount, slippageBps } = req.query;
  const invalidAddress = findInvalidAddressParam({ inputMint, outputMint, publicKey });
  if (invalidAddress) {
    return res.status(400).json({
      error: 'invalid_parameter',
      error_description: `${invalidAddress} is not a valid Solana address`,
    });
  }
  if (inputMint === outputMint) {
    return res.status(400).json({
      error: 'invalid_parameter',
      error_description: 'inputMint and outputMint must differ',
    });
  }
  if (res.locals.network?.id !== SWAP_NETWORK) {
    return res.status(400).json({
      error: 'invalid_parameter',
      error_description: `Swap is available on ${SWAP_NETWORK} only`,
    });
  }

  const resolvedSlippage = swapBuildService.resolveSlippage(slippageBps);
  if (resolvedSlippage.error) {
    return res.status(400).json(resolvedSlippage);
  }
  const resolvedAmount = await swapBuildService.resolveAmount(
    { amount, uiAmount, inputMint },
    res.locals
  );
  if (resolvedAmount.error) {
    return res.status(400).json(resolvedAmount);
  }

  const data = await swapBuildService.build(
    {
      inputMint,
      outputMint,
      publicKey,
      amount: resolvedAmount.amount,
      slippageBps: resolvedSlippage.slippageBps,
    },
    res.locals
  );
  const resource = await decorator(decorateSwapBuild, data, { req, res });
  res.status(200).send(resource);
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

module.exports = { build, verified, search };
