'use strict';

/**
 * Solana NFT HTTP surface, mounted at `/nft` under
 * `src/routes/solana/index.js` (chain slice mounted at
 * `/v1/solana-:env` by the `BLOCKCHAINS` loop in `src/index.js`).
 *
 * Endpoints (per `solana-nft-listing` / `solana-nft-burn`):
 *   - GET  /                        — NFT list for an owner, flat backend shape (cached 60s).
 *   - POST /:mintAddress            — build a burn transaction, routed by token
 *     standard (cNFT v1/v2, pNFT, edition, master) (no-cache).
 *   - POST /:mintAddress/transfer   — build an NFT transfer transaction (no-cache).
 *
 * No auth middleware; network resolution happens upstream in the chain
 * mount, not per-route here.
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const { cacheControl } = require('../../../packages/middleware');
const nftController = require('../../controllers/solana/solana-nft-controller');

const router = express.Router();

router.get('/', cacheControl('max-age=60'), safe(nftController.list));
router.post('/:mintAddress', safe(nftController.burnTransaction));
// Explicit transfer route must be declared alongside the burn catch-all POST.
router.post('/:mintAddress/transfer', safe(nftController.transferTransaction));

module.exports = router;
