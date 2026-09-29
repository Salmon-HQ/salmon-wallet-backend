'use strict';

const { decorator } = require('../../../packages/api-utils');
const buildService = require('../../services/solana/powerups/powerup-build-service');
const decorateBuild = require('../../resources/solana/solana-powerup-build-resource');
const { isValidSolanaAddress } = require('../../utils/solana-address');

/**
 * Builds an UNSIGNED transaction for the Powerup `:id` (`community-powerups`
 * contract; root AGENTS.md "Signing boundary").
 *
 * @param {import('express').Request} req - Reads `params.id` and `query.publicKey`
 *   (required, the fee payer); the Powerup's own params are validated by its adapter.
 * @param {import('express').Response} res - Responds 200 with the Powerup build
 *   resource; 400 `{ error, error_description }` on a missing/invalid `publicKey`.
 *   404 `not_found`, 502 `provider_program_mismatch`, 422 `simulation_failed` and
 *   the resilience 503s reach the error middleware from the service.
 * @returns {Promise<void>}
 */
const build = async (req, res) => {
  const { id } = req.params;
  const { publicKey } = req.query;
  if (!publicKey) {
    return res.status(400).json({
      error: 'missing_parameter',
      error_description: 'Missing required query params: publicKey',
    });
  }
  if (!isValidSolanaAddress(publicKey)) {
    return res.status(400).json({
      error: 'invalid_parameter',
      error_description: 'publicKey is not a valid Solana address',
    });
  }

  const network = res.locals.network?.id;
  try {
    const data = await buildService.build(id, req.query, res.locals);
    console.info('[POWERUP_BUILD]', { id, network, outcome: 'built' });
    const resource = await decorator(decorateBuild, data, { req, res });
    res.status(200).send(resource);
  } catch (error) {
    console.info('[POWERUP_BUILD]', { id, network, outcome: error.errorCode || 'server_error' });
    throw error;
  }
};

module.exports = { build };
