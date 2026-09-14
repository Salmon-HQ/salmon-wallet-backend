'use strict';

/**
 * Solana fungible-token HTTP surface, mounted at `/ft` under
 * `src/routes/solana/index.js` (chain slice mounted at
 * `/v1/solana-:env` by the `BLOCKCHAINS` loop in `src/index.js`).
 *
 * Endpoints (per `solana-fungible-token-catalog`):
 *   - GET  /verified              — verified-token list (cached 300s).
 *   - GET  /search                — token search (no-cache).
 *
 * The surface is read-only: it lists and searches tokens and builds nothing.
 * No route here moves an asset or asks a third party to move one, so an
 * unauthenticated caller can read the catalogue and nothing else.
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

module.exports = router;
