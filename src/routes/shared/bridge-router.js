'use strict';

/**
 * Cross-chain bridge aggregator surface (StealthEX-backed), mounted at
 * `/v1/bridge` (see `src/index.js`).
 *
 * Endpoints:
 *   - GET /available   — supported currencies/chains.
 *   - GET /estimate     — estimated exchange amount for a pair.
 *   - GET /minimal      — minimal exchangeable amount for a pair.
 *   - POST /exchange    — create an exchange order (preferred).
 *   - GET /exchange     — create an exchange order (legacy, kept for
 *     already-shipped clients; retried GETs can duplicate orders).
 *   - GET /transaction  — look up exchange/transaction status.
 *
 * No caching or network-resolution middleware applied.
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const controller = require('../../controllers/shared/bridge-controller');

const router = express.Router();

router.get('/available', safe(controller.listAvailable));
router.get('/estimate', safe(controller.getEstimate));
router.get('/minimal', safe(controller.getMinimalAmountIn));
router.post('/exchange', safe(controller.createExchangeFromBody));
router.get('/exchange', safe(controller.createExchange));
router.get('/transaction', safe(controller.getTransaction));

module.exports = router;
