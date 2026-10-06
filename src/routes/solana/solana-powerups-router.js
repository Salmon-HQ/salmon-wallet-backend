'use strict';

/**
 * Generic Powerup HTTP surface, mounted at `/powerups` under
 * `src/routes/solana/index.js` (chain slice mounted at `/v1/solana-:env`).
 *
 * Endpoints:
 *   - GET /availability — what this caller may use on the network
 *                         (`capability-availability` contract, no-store).
 *                         Declared before `/:id/build` so the literal wins.
 *   - GET /:id/build — UNSIGNED transaction for a registered,
 *                      transaction-building Powerup (no-cache). Passes the
 *                      `powerupGate` seam (spec 018) before the controller.
 *                      No execute/broadcast route exists by design (root
 *                      AGENTS.md "Signing boundary").
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const powerupGate = require('../../middlewares/powerup-gate');
const controller = require('../../controllers/solana/solana-powerups-controller');

const router = express.Router();

router.get('/availability', safe(controller.availability));
router.get('/:id/build', powerupGate('param'), safe(controller.build));

module.exports = router;
