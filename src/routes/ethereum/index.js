'use strict';

/**
 * Ethereum HTTP surface.
 *
 * Empty on purpose — the Ethereum slice exists as a skeleton so the
 * blockchain-mount loop in `src/index.js` can require this module
 * without crashing at boot.
 *
 * The Ethereum networks are defined in `src/constants/networks.js` but
 * are NOT in any `src/network-capabilities/network-capabilities-${stage}.js`
 * `enable` list, so the FE never sees Ethereum as an active network and
 * cannot route requests here in production.
 *
 * To activate Ethereum:
 *   1. Add Ethereum-specific endpoints (controllers + services + resources).
 *   2. Add the network ids (`ethereum-mainnet`, `ethereum-sepolia`) to
 *      the `enable` list in EVERY stage file under
 *      `src/network-capabilities/network-capabilities-{develop,local,main,prod}.js`
 *      (or only the stages where Ethereum should be live). The stage
 *      files are byte-identical today; see
 *      `src/network-capabilities/AGENTS.md` for the convention.
 *   3. (Optional) Register an Ethereum-specific balance provider in
 *      `src/services/multichain/balance-providers/index.js#PROVIDERS_BY_CHAIN`
 *      and add `ETHEREUM` to the `multichain/account-router` allowlist
 *      so the cross-chain balance endpoint exposes Ethereum.
 */

const express = require('express');

const router = express.Router();

module.exports = router;
