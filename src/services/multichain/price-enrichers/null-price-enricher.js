'use strict';

/**
 * No-op price enricher.
 *
 * Returned by `./index.js` when the requested blockchain has no
 * dedicated enricher registered. Lets `account-service.getBalance` run
 * a uniform "fetch + enrich" flow without per-chain branching at the
 * call site.
 */

const enrich = async (items) => items;

module.exports = { enrich };
