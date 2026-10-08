'use strict';

const skrService = require('../../services/solana/skr-staking-service');
const decorate = require('../../resources/solana/solana-skr-stake-resource');
const { isValidSolanaAddress } = require('../../utils/solana-address');

/**
 * The owner's SKR staking position (spec 021). SKR staking exists on mainnet
 * only, so every other network answers 404.
 *
 * @param {import('express').Request} req - reads `query.owner`.
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
const getStake = async (req, res) => {
  if (res.locals.network?.id !== 'solana-mainnet') {
    return res.status(404).json({
      error: 'not_found',
      error_description: 'SKR staking exists on solana-mainnet only.',
    });
  }
  const { owner } = req.query;
  if (!isValidSolanaAddress(owner)) {
    return res.status(400).json({
      error: 'bad_request',
      error_description: 'owner is not a valid Solana address.',
    });
  }
  const result = await skrService.getSkrStake(owner, res.locals);
  return res.status(200).send(decorate(result));
};

module.exports = { getStake };
