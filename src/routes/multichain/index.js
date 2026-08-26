'use strict';

/**
 * Multichain slice root. Mounted at `/v1` (see `src/index.js`), alongside
 * the per-blockchain chain mounts.
 *
 * Composes:
 *   - `/` — `account-router` (cross-chain balance endpoint).
 */

const express = require('express');

const router = express.Router();

router.use('/', require('./account-router'));

module.exports = router;
