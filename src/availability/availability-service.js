'use strict';

/**
 * Where a capability is offered to this caller (spec 018): the table row
 * for (capability, platform, country) → enabled, a reason when not, and the
 * routing provider when the capability has one. Decided per request, never
 * stored.
 */

const catalog = require('../services/solana/powerups/powerup-catalog-service');
const networkCapabilitiesService = require('../services/shared/network-capabilities-service');
const { rowsFor } = require('./availability-table');

/** Capabilities that live outside the Powerup registry but sit in the table. */
const SWAP = { id: 'swap', networks: ['solana-mainnet'] };

/**
 * @param {object} table - a validated availability table.
 * @param {string} capability
 * @param {'ios'|'android'|'extension'} platform
 * @param {string|null} country - ISO alpha-2, or null when unresolved.
 * @returns {{ enabled: boolean, reason?: 'region', provider?: string }}
 */
const decide = (table, capability, platform, country) => {
  const entry = table.capabilities?.[capability];
  if (!entry) return { enabled: true };
  const rows = rowsFor(entry, platform);
  if (country && rows.unavailable.includes(country)) return { enabled: false, reason: 'region' };
  let provider = rows.default;
  if (country) {
    for (const [name, countries] of Object.entries(rows.providers)) {
      if (countries.includes(country)) {
        provider = name;
        break;
      }
    }
  }
  return provider ? { enabled: true, provider } : { enabled: true };
};

/**
 * The catalogue's `[{ id, enabled, reason? }]` for `networkId` with this
 * caller's decision merged in, plus the swap capability when the stage
 * switch names it and the network carries it.
 */
const listFor = (table, networkId, platform, country) => {
  const merge = (entry) =>
    entry.enabled ? { id: entry.id, ...decide(table, entry.id, platform, country) } : entry;
  const entries = catalog.listFor(networkId).map(merge);
  const stage = networkCapabilitiesService.getPowerups() || {};
  if (SWAP.networks.includes(networkId) && stage[SWAP.id]) {
    const { enabled, reason } = stage[SWAP.id];
    entries.push(enabled ? merge({ id: SWAP.id, enabled }) : { id: SWAP.id, enabled, reason });
  }
  return entries;
};

module.exports = { decide, listFor, SWAP };
