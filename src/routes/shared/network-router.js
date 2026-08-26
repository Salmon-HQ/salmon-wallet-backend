'use strict';

/**
 * Network catalog surface, mounted at `/v1/networks` (see `src/index.js`).
 *
 * Endpoints:
 *   - GET / — stage-derived network list with `enabled` + `sections`, per
 *     the `network-catalog` spec (cached 3600s).
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const { cacheControl } = require('../../../packages/middleware');
const controller = require('../../controllers/shared/network-controller');

const router = express.Router();

router.get('/', cacheControl('max-age=3600'), safe(controller.list));

module.exports = router;
