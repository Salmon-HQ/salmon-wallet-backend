'use strict';

/**
 * Solana account HTTP surface, mounted at `/account` under
 * `src/routes/solana/index.js` (chain slice mounted at
 * `/v1/solana-:env` by the `BLOCKCHAINS` loop in `src/index.js`).
 *
 * Endpoints:
 *   - GET /:address/transactions — tx history (no-cache), per
 *     `solana-transaction-enrichment`.
 *
 * No auth middleware; network resolution happens upstream in the chain
 * mount, not per-route here.
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const { cacheControl } = require('../../../packages/middleware');
const controller = require('../../controllers/solana/solana-account-controller');

const router = express.Router();

router.get('/:address/transactions', cacheControl('no-cache'), safe(controller.listTransactions));

module.exports = router;
