'use strict';

/**
 * Public shape of `GET /powerups/:id/build` (`community-powerups` contract).
 *
 * Mirrors `solana-swap-build-resource` field names so the client's one
 * proposal mapper covers every Powerup: provider fields are data, fee lines
 * are objects or null, `contributor` names who shipped the Powerup, and the
 * adapter's typed `display` fields are spread at the top level.
 */

module.exports = (build) => ({
  transaction: build.transaction,
  expiresAt: build.expiresAt,
  provider: build.provider?.id ?? null,
  providerDisplayName: build.provider?.displayName ?? null,
  attribution: build.provider?.attribution ?? null,
  salmonFee: build.salmonFee,
  routeFee: null,
  contributor: build.contributor,
  priorityFeeMicroLamports: build.priorityFeeMicroLamports,
  computeUnitLimit: build.computeUnitLimit,
  ...build.display,
});
