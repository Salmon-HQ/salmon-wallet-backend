'use strict';

/**
 * Network catalog service.
 *
 * Returns the canonical, public-facing network catalog (id, label, RPC,
 * explorer wiring) merged with per-stage capability flags from
 * `network-capabilities-service`. Drives the wallet's network picker and
 * feature gating.
 */

const NETWORKS = require('../../constants/networks');
const networkCapabilitiesService = require('./network-capabilities-service');

/**
 * Capability map for the current stage.
 *
 * A missing map means the stage is misconfigured. Defaulting to `{}` answered
 * 200 with every network `enabled: false`, which the wallet reads as "this
 * build supports no networks" — and it caches that answer for the session
 * while CloudFront holds it for an hour. Fail loudly instead.
 *
 * @returns {Object<string, Object>}
 * @throws {Error} 503 `network_catalog_unavailable` when capabilities cannot
 *   be resolved.
 */
const getNetworkCapabilitiesMap = () => {
  const capabilities = networkCapabilitiesService.get();
  if (capabilities) return capabilities;

  const error = new Error('The network catalog is temporarily unavailable.');
  error.statusCode = 503;
  error.errorCode = 'network_catalog_unavailable';
  throw error;
};

const mergeNetworkCapabilities = (network, capabilities) => {
  const networkCapabilities = capabilities[network.id];

  return {
    ...network,
    enabled: networkCapabilities?.enable ?? false,
    sections: networkCapabilities?.sections || {},
  };
};

/**
 * List every configured network with `enabled` and `sections` populated
 * from the current stage's capabilities map.
 * @returns {Array<Object>} Networks decorated with `enabled` + `sections`.
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
