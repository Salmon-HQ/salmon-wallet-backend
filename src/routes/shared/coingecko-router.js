'use strict';

/**
 * CoinGecko market-data surface, mounted at `/v1` (see `src/index.js`).
 *
 * Endpoints:
 *   - GET /exchange-rates        — BTC-denominated exchange rates (cached 900s).
 *   - GET /chart/:coinId         — market chart data (cached 300s).
 *   - GET /chart/:platform/contract/:address — market chart by mint (cached 300s).
 *   - GET /coin/:coinId          — coin detail (cached 300s).
 *   - GET /coin/:platform/contract/:address — coin detail by mint (cached 300s).
 *
 * Chain-agnostic; no network-resolution middleware applied.
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const { cacheControl } = require('../../../packages/middleware');
const controller = require('../../controllers/shared/coingecko-controller');

const router = express.Router();

router.get('/exchange-rates', cacheControl('max-age=900'), safe(controller.getExchangeRates));
router.get('/chart/:coinId', cacheControl('max-age=300'), safe(controller.getMarketChart));
router.get(
  '/chart/:platform/contract/:address',
  cacheControl('max-age=300'),
  safe(controller.getContractMarketChart)
);
router.get('/coin/:coinId', cacheControl('max-age=300'), safe(controller.getCoinInfo));
router.get(
  '/coin/:platform/contract/:address',
  cacheControl('max-age=300'),
  safe(controller.getContractCoinInfo)
);

module.exports = router;
