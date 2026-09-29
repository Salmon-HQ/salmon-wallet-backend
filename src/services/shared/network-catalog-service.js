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
 * Capability map for the current stage.
 *
 * A missing map means the stage is misconfigured. Defaulting to `{}` answered
 * 200 with every network `enabled: false`, which the wallet reads as "this
 * build supports no networks" — and it caches that answer for the session
 * while CloudFront holds it for an hour. Fail loudly instead (the Powerup
 * catalog fails the same way on an invalid `powerups` block).
 *
 * @returns {Object<string, Object>}
 * @throws {Error} 503 `network_catalog_unavailable` when capabilities cannot
 *   be resolved.
 */
const getNetworkCapabilitiesMap = () => {
  const capabilities = networkCapabilitiesService.get();
  if (capabilities) return capabilities;
  throw powerupCatalog.catalogUnavailableError();
};

const mergeNetworkCapabilities = (network, capabilities) => {
  const networkCapabilities = capabilities[network.id];

  return {
    ...network,
    enabled: networkCapabilities?.enable ?? false,
    sections: networkCapabilities?.sections || {},
    powerups: powerupCatalog.listFor(network.id),
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
  const capabilities = getNetworkCapabilitiesMap();
  return NETWORKS.map((network) => mergeNetworkCapabilities(network, capabilities));
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
