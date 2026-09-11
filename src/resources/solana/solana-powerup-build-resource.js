'use strict';

/**
 * Public shape of `GET /powerups/:id/build` (`community-powerups` contract).
 *
 * The swap's envelope, flat: provider fields are data, fee lines are objects
 * or null, `contributor` names who shipped the Powerup, and the adapter's
 * typed `display` fields are spread at the top level (no nested object).
 *
 * `salmonFee` is null in this feature. When a fee line exists it must carry
 * `decimals` + `symbol` for its mint like `feeLine` in
 * `solana-swap-build-resource`, so the client renders it without a lookup.
 */

module.exports = (build) => ({
  provider: build.provider?.id ?? null,
  providerDisplayName: build.provider?.displayName ?? null,
  attribution: build.provider?.attribution ?? null,
  transaction: build.transaction,
  expiresAt: build.expiresAt,
  salmonFee: null,
  routeFee: null,
  contributor: build.contributor,
  priorityFeeMicroLamports: build.priorityFeeMicroLamports,
  computeUnitLimit: build.computeUnitLimit,
  ...build.display,
});
