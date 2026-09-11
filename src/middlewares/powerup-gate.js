'use strict';

/**
 * Powerup build gate — the single seam every `/powerups/:id/build` request
 * passes through before its adapter runs.
 *
 * Spec 011 (region gating: viewer country vs the Powerup's allowlist → 403
 * `region_restricted`; sanctions screening of the address → 403
 * `wallet_restricted`) is not implemented yet, so this is a documented
 * no-op: it calls `next()` and logs nothing. When 011 lands, the check goes
 * here and only here — never one edit per Powerup. Per-request refusals
 * stay on this route and never reach the cached `/v1/networks` catalog.
 *
 * @param {import('express').Request} _req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
const powerupGate = (_req, _res, next) => next();

module.exports = powerupGate;
