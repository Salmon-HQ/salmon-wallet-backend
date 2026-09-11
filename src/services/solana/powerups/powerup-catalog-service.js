'use strict';

/**
 * Powerup catalog — the `powerups` array `/v1/networks` publishes per network
 * (`community-powerups` contract): registry ∩ stage config ∩ the entry's
 * declared networks. Region-agnostic and cacheable: nothing per request.
 */

const { POWERUPS } = require('./registry');

/**
 * @param {string} networkId
 * @param {Object<string, { enabled: boolean, reason?: string }>} stagePowerups -
 *   the validated stage block (`network-capabilities-service.getPowerups()`)
 * @returns {Array<{ id: string, enabled: boolean, reason?: string }>} `reason`
 *   only when disabled
 */
const listFor = (networkId, stagePowerups) =>
  Object.keys(POWERUPS)
    .filter((id) => POWERUPS[id].networks.includes(networkId) && id in stagePowerups)
    .map((id) => {
      const { enabled, reason } = stagePowerups[id];
      return enabled ? { id, enabled } : { id, enabled, reason };
    });

module.exports = { listFor };
