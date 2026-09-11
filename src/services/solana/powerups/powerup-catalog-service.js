'use strict';

/**
 * Powerup catalog — the `powerups` array `/v1/networks` publishes per network
 * (`community-powerups` contract): registry ∩ stage config ∩ the entry's
 * declared networks, and nothing on a network the stage disables.
 * Region-agnostic and cacheable: nothing per request. The build route
 * resolves through the same predicate (`isOffered`), so a Powerup is never
 * buildable while invisible in the catalog.
 */

const networkCapabilitiesService = require('../../shared/network-capabilities-service');
const { POWERUPS } = require('./registry');

/** 503 the catalog answers when the stage config cannot be resolved. */
const catalogUnavailableError = () => {
  const error = new Error('The network catalog is temporarily unavailable.');
  error.statusCode = 503;
  error.errorCode = 'network_catalog_unavailable';
  return error;
};

/**
 * @param {string} networkId
 * @returns {Array<{ id: string, enabled: boolean, reason?: string }>} `reason`
 *   only when disabled; `[]` when the network itself is disabled on the stage
 * @throws {Error} 503 `network_catalog_unavailable` when the stage config is invalid
 */
const listFor = (networkId) => {
  const capabilities = networkCapabilitiesService.get();
  const stagePowerups = capabilities && networkCapabilitiesService.getPowerups();
  if (!stagePowerups) {
    throw catalogUnavailableError();
  }
  if (!capabilities[networkId]?.enable) {
    return [];
  }
  return Object.keys(POWERUPS)
    .filter((id) => POWERUPS[id].networks.includes(networkId) && id in stagePowerups)
    .map((id) => {
      const { enabled, reason } = stagePowerups[id];
      return enabled ? { id, enabled } : { id, enabled, reason };
    });
};

/** True when the catalog lists `id` enabled on `networkId`. */
const isOffered = (id, networkId) =>
  listFor(networkId).some((entry) => entry.id === id && entry.enabled);

module.exports = { listFor, isOffered, catalogUnavailableError };
