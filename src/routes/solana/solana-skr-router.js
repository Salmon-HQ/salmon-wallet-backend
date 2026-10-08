'use strict';

/**
 * SKR staking, mounted at `/skr` under `src/routes/solana/index.js`.
 *
 * Endpoints:
 *   - GET /stake?owner= — the owner's SKR staking position, per
 *     `solana-skr-staking`. Read-only; mainnet only.
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const { cacheControl } = require('../../../packages/middleware');
const controller = require('../../controllers/solana/solana-skr-controller');

const router = express.Router();

router.get('/stake', cacheControl('max-age=60'), safe(controller.getStake));

module.exports = router;
