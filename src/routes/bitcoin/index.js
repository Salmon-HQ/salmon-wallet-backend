'use strict';

/**
 * Bitcoin chain slice root. Mounted by the `BLOCKCHAINS` loop in
 * `src/index.js` at `/v1/bitcoin-:env`, behind the inline network
 * resolver that sets `res.locals.network` from the `:env` path segment.
 *
 * Composes:
 *   - `/account` — `bitcoin-account-router` (account info, tx history, UTXO, send).
 */

const express = require('express');

const router = express.Router();

router.use('/account', require('./bitcoin-account-router'));

module.exports = router;
