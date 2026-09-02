'use strict';

/**
 * Bitcoin account HTTP surface, mounted at `/account` under
 * `src/routes/bitcoin/index.js` (chain slice mounted at
 * `/v1/bitcoin-:env` by the `BLOCKCHAINS` loop in `src/index.js`).
 *
 * Endpoints:
 *   - GET  /:address/transactions         — tx history (no-cache).
 *   - GET  /:address/utxo                 — UTXO set (no-cache).
 *
 * Read-only by design: the wallet broadcasts its signed transaction
 * directly to a public endpoint; the backend never receives signed bytes.
 *
 * No auth middleware; network resolution happens upstream in the chain
 * mount, not per-route here.
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const { cacheControl } = require('../../../packages/middleware');
const controller = require('../../controllers/bitcoin/bitcoin-account-controller');
const { isValidBitcoinAddress } = require('../../utils/bitcoin-address');

const router = express.Router();

// Every route below takes `:address`; reject a malformed one here so it never
// reaches Blockdaemon (which would answer with an upstream error, not a 400).
router.param('address', (req, res, next, address) => {
  if (isValidBitcoinAddress(address)) return next();
  return res.status(400).json({
    error: 'invalid_parameter',
    error_description: 'The address parameter is not a valid Bitcoin address.',
  });
});

router.get('/:address/transactions', cacheControl('no-cache'), safe(controller.listTransactions));

router.get('/:address/utxo', cacheControl('no-cache'), safe(controller.listUtxo));

module.exports = router;
