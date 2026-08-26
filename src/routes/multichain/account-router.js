'use strict';

/**
 * Cross-chain account balance surface, mounted at `/v1` under
 * `src/routes/multichain/index.js` (see `src/index.js`).
 *
 * Endpoints:
 *   - GET /:networkId/account/:address/balance — array-shape balance
 *     response with native/token branching per `multichain-account-balance`
 *     (no-cache).
 *
 * Gated by `multinetwork({ blockchains: BALANCE_CHAINS })`: resolves
 * `:networkId` into `res.locals.network` and 400s on an unknown network id;
 * chains not in `BALANCE_CHAINS` fall through unmatched (see allowlist
 * comment below).
 */

const express = require('express');
const { safe } = require('../../../packages/api-utils');
const { cacheControl } = require('../../../packages/middleware');
const multinetwork = require('../../middlewares/multinetwork');
const controller = require('../../controllers/multichain/account-controller');
const { networkPath } = require('../shared/network-route-path');
const { BITCOIN, SOLANA } = require('../../constants/blockchains');

const router = express.Router();

// Allowlist of chains for which the multichain balance endpoint is
// publicly exposed. Add a new chain here ONLY after:
//   1. its networks are gated in via network-capabilities-${stage}.js
//   2. (optional) a richer balance provider is registered in
//      src/services/multichain/balance-providers/index.js#PROVIDERS_BY_CHAIN.
// The default Blockdaemon Universal provider already covers any chain
// Blockdaemon supports, so adding ETHEREUM here unlocks balance
// without a custom provider — but DO NOT add it without confirming the
// network entries are intentional and the FE is ready.
const BALANCE_CHAINS = [BITCOIN, SOLANA];

router.get(
  `/${networkPath()}/account/:address/balance`,
  multinetwork({ blockchains: BALANCE_CHAINS }),
  cacheControl('no-cache'),
  safe(controller.showBalance)
);

module.exports = router;
