'use strict';

const skrService = require('../../services/solana/skr-staking-service');
const decorate = require('../../resources/solana/solana-skr-stake-resource');
const { isValidSolanaAddress } = require('../../utils/solana-address');
const { withSingleFlight, getCacheKeyFor } = require('../../infrastructure/cache/cache-helper');

// One read is about five Triton calls plus the owner's transactions; the
// route's Cache-Control is 60 s, so the server keeps the same answer that
// long, with one flight per owner and a stale copy while a refresh fails.
const STAKE_TTL_SECONDS = 60;
const STAKE_STALE_TTL_SECONDS = 600;
const STAKE_LOCK_MS = 10000;

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
  const resource = await withSingleFlight(getCacheKeyFor('skr_stake', 'owner', owner, res.locals), {
    ttl: STAKE_TTL_SECONDS,
    staleTtl: STAKE_STALE_TTL_SECONDS,
    lockMs: STAKE_LOCK_MS,
    rebuild: async () => decorate(await skrService.getSkrStake(owner, res.locals)),
    locals: res.locals,
  });
  return res.status(200).send(resource);
};

module.exports = { getStake };
