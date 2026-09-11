'use strict';

/**
 * Network catalog service.
 *
 * Returns the canonical, public-facing network catalog (id, label, RPC,
 * explorer wiring) merged with per-stage capability flags and the
 * per-network Powerup list from `network-capabilities-service`. Drives the wallet's network picker and
 * feature gating.
 */

const { ATTRIBUTION } = require('./coingecko-service');
const NETWORKS = require('../../constants/networks');
const networkCapabilitiesService = require('./network-capabilities-service');
const powerupCatalog = require('../solana/powerups/powerup-catalog-service');

/**
 * Capability map + Powerup flags for the current stage.
 *
 * A missing map means the stage is misconfigured. Defaulting to `{}` answered
 * 200 with every network `enabled: false`, which the wallet reads as "this
 * build supports no networks" — and it caches that answer for the session
 * while CloudFront holds it for an hour. Fail loudly instead; an invalid
 * `powerups` block (unknown reason) fails the same way.
 *
 * @returns {{ capabilities: Object<string, Object>, powerups: Object<string, Object> }}
 * @throws {Error} 503 `network_catalog_unavailable` when either cannot be
 *   resolved.
 */
const getStageConfig = () => {
  const capabilities = networkCapabilitiesService.get();
  const powerups = capabilities && networkCapabilitiesService.getPowerups();
  if (capabilities && powerups) return { capabilities, powerups };

  const error = new Error('The network catalog is temporarily unavailable.');
  error.statusCode = 503;
  error.errorCode = 'network_catalog_unavailable';
  throw error;
};

const mergeNetworkCapabilities = (network, { capabilities, powerups }) => {
  const networkCapabilities = capabilities[network.id];
  const enabled = networkCapabilities?.enable ?? false;

  return {
    ...network,
    enabled,
    sections: networkCapabilities?.sections || {},
    // A Powerup is never offered on a network the stage disables.
    powerups: enabled ? powerupCatalog.listFor(network.id, powerups) : [],
    // Token catalog + USD prices on solana-mainnet come from CoinGecko, whose
    // terms require a visible, linked attribution; clients render it verbatim.
    attribution: network.id === 'solana-mainnet' ? ATTRIBUTION : null,
  };
};

/**
 * List every configured network with `enabled`, `sections` and `powerups`
 * populated from the current stage's config.
 * @returns {Array<Object>} Networks decorated with `enabled` + `sections` + `powerups`.
 */
const list = () => {
  const stageConfig = getStageConfig();
  return NETWORKS.map((network) => mergeNetworkCapabilities(network, stageConfig));
};

/**
 * Return a single decorated network by id, or `undefined` when unknown.
 * @param {string} id - Network id (e.g. `solana-mainnet`).
 * @returns {Object|undefined}
 */
const show = (id) => {
  return list().find((network) => network.id === id);
};

module.exports = { list, show };
