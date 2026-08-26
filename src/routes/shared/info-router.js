'use strict';

/**
 * Service info surface, mounted at `/` (see `src/index.js`) — before the
 * `/v1` prefix, so these paths are unversioned.
 *
 * Endpoints:
 *   - GET /health — liveness check.
 *   - GET /status — service status detail.
 *   - GET /ip     — caller IP echo.
 *
 * No auth, caching, or network-resolution middleware applied.
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const infoController = require('../../controllers/shared/info-controller');

const router = express.Router();

router.get('/health', safe(infoController.health));
router.get('/status', safe(infoController.status));
router.get('/ip', safe(infoController.ip));

module.exports = router;
