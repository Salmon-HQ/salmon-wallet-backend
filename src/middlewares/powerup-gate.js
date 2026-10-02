'use strict';

/**
 * Powerup gate — the single seam every capability request passes through
 * before its adapter runs (spec 018, amending spec 011).
 *
 * Resolves the caller's platform (`X-Salmon-Platform`) and country (source
 * address → DB-IP), asks the availability table, and either refuses with
 * `403 region_restricted` before any provider call or records the decision
 * in `res.locals.availability = { capability, platform, country, provider }`
 * for the build service to pick its adapter. Logs `[POWERUP_GATE]` with the
 * decision and never the address or the wallet.
 *
 * On rows whose provider does not screen wallets itself
 * (`SCREENED_BY_SALMON`, Jupiter), the caller's `publicKey` is screened
 * against the sanctions layers → `403 wallet_restricted`; a missing or
 * malformed `publicKey` is left to the controller's 400. 0x rows skip it:
 * 0x screens on its side.
 */

const { platformOf } = require('../availability/platform');
const { countryOfRequest } = require('../availability/country-resolver');
const { loadTable } = require('../availability/availability-table');
const { decide, SCREENED_BY_SALMON } = require('../availability/availability-service');
const { isListed } = require('../services/shared/sanctions-service');
const { isValidSolanaAddress } = require('../utils/solana-address');

/**
 * @param {string} capability - a capability id, or `'param'` to read `req.params.id`.
 * @returns {import('express').RequestHandler}
 */
const powerupGate = (capability) => async (req, res, next) => {
  const id = capability === 'param' ? req.params.id : capability;
  const platform = platformOf(req);
  const country = countryOfRequest(req);
  const decision = decide(await loadTable(), id, platform, country);
  const provider = decision.provider ?? null;
  console.info('[POWERUP_GATE]', {
    capability: id,
    platform,
    country,
    enabled: decision.enabled,
    provider,
  });
  if (!decision.enabled) {
    return res.status(403).json({
      error: 'region_restricted',
      error_description: 'This feature is not offered in your region.',
    });
  }
  const { publicKey } = req.query || {};
  if (SCREENED_BY_SALMON.includes(provider) && isValidSolanaAddress(publicKey)) {
    if (await isListed(publicKey, { locals: res.locals })) {
      console.info('[POWERUP_GATE]', {
        capability: id,
        platform,
        country,
        outcome: 'wallet_restricted',
      });
      return res.status(403).json({
        error: 'wallet_restricted',
        error_description: 'This wallet cannot use this feature.',
      });
    }
  }
  res.locals.availability = { capability: id, platform, country, provider };
  return next();
};

module.exports = powerupGate;
