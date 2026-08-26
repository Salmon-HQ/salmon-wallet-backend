'use strict';

/**
 * Dapp metadata surface, mounted at `/v1/dapp` (see `src/index.js`).
 *
 * Endpoints:
 *   - GET /metadata — OpenGraph-derived `{ name, icon }` for a given dapp URL
 *     (cached 60s).
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const { cacheControl } = require('../../../packages/middleware');
const controller = require('../../controllers/shared/dapp-controller');

const router = express.Router();

router.get('/metadata', cacheControl('max-age=60'), safe(controller.showMetadata));

module.exports = router;
