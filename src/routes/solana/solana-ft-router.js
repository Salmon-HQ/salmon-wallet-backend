'use strict';

/**
 * Solana fungible-token HTTP surface, mounted at `/ft` under
 * `src/routes/solana/index.js` (chain slice mounted at
 * `/v1/solana-:env` by the `BLOCKCHAINS` loop in `src/index.js`).
 *
 * Endpoints (per `solana-fungible-token-catalog` /
 * `solana-swap-orchestration`):
 *   - GET  /verified              — verified-token list (cached 300s).
 *   - GET  /search                — token search (no-cache).
 *   - GET  /swap/order            — Jupiter Ultra swap quote (no-cache).
 *   - POST /swap/execute          — Jupiter Ultra swap execution (no-cache).
 *
 * No auth middleware; network resolution happens upstream in the chain
 * mount, not per-route here.
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const { cacheControl } = require('../../../packages/middleware');
const controller = require('../../controllers/solana/solana-ft-controller');

const router = express.Router();

router.get('/verified', cacheControl('max-age=300'), safe(controller.verified));
router.get('/search', safe(controller.search));
router.get('/swap/order', safe(controller.order));
router.post('/swap/execute', safe(controller.execute));

module.exports = router;
