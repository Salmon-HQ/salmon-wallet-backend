'use strict';

/**
 * Solana chain slice root. Mounted by the `BLOCKCHAINS` loop in
 * `src/index.js` at `/v1/solana-:env`, behind the inline network resolver
 * that sets `res.locals.network` from the `:env` path segment.
 *
 * Composes:
 *   - `/ft`      — `solana-ft-router` (fungible token catalog, pricing, swap).
 *   - `/account` — `solana-account-router` (account info, tx history).
 *   - `/nft`     — `solana-nft-router` (NFT listing, burn).
 *   - `/powerups` — `solana-powerups-router` (generic unsigned Powerup build).
 */

const express = require('express');

const router = express.Router();

router.use('/ft', require('./solana-ft-router'));
router.use('/account', require('./solana-account-router'));
router.use('/nft', require('./solana-nft-router'));
router.use('/powerups', require('./solana-powerups-router'));

module.exports = router;
