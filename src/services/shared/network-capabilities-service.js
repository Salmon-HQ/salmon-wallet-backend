'use strict';

/**
 * Network capabilities service.
 *
 * Resolves per-stage feature flags (e.g. swap, NFTs, history) for every
 * configured network by loading `network-capabilities-<NODE_ENV>.js` and
 * matching each rule against the network id / blockchain. Used by
 * `network-catalog-service` to decorate the public network catalog.
 */

const mapValues = require('lodash/mapValues');
const omit = require('lodash/omit');
const NETWORKS = require('../../constants/networks');

const SUPPORTED_STAGES = ['develop', 'local', 'main', 'prod'];
/** Stage-level reasons a Powerup can be switched off with (`community-powerups` contract). */
const POWERUP_DISABLED_REASONS = ['region', 'maintenance', 'deprecated'];
/** Stage-file key that is a per-Powerup block, not a network rule tree. */
const POWERUPS_KEY = 'powerups';

/**
 * Recursively evaluate a capabilities rule tree against `network`.
 * A leaf rule matches when it is `'*'` or equals the network's `id`/`blockchain`
 * (string form), or when it is an array containing either (array form).
 * Nested objects are walked recursively so a capability can have sub-flags
 * (e.g. `sections.swap`). The `powerups` block is skipped: its values are
 * per-Powerup flags, not network matches.
 * @param {Object} values - Rule tree (from `network-capabilities-<stage>.js`).
 * @param {Object} network - Network descriptor with `id` and `blockchain`.
 * @returns {Object} Same shape as `values`, with every leaf resolved to a boolean.
 */
const check = (values, network) => {
  return mapValues(omit(values, POWERUPS_KEY), (value) => {
    if (typeof value === 'string') {
      return value === '*' || value === network.id || value === network.blockchain;
    }
    if (Array.isArray(value)) {
      return value.includes(network.id) || value.includes(network.blockchain);
    }
    if (typeof value === 'object' && !!value) {
      return check(value, network);
    }
    return false;
  });
};

/**
 * Load `network-capabilities-<NODE_ENV>.js`, or `undefined` (logged) when
 * `NODE_ENV` is unsupported or the module fails to load.
 * @returns {Object|undefined}
 */
const loadStage = () => {
  const stage = process.env.NODE_ENV;

  if (!stage || !SUPPORTED_STAGES.includes(stage)) {
    // Misconfigured stage collapses every network to enabled:false downstream.
    // Surface the misconfiguration loudly so deploy pipelines can catch it.
    console.error(
      `[network-capabilities] NODE_ENV is "${stage || ''}", expected one of ${SUPPORTED_STAGES.join(', ')}. ` +
        'All networks will report enabled=false until this is fixed.'
    );
    return undefined;
  }

  try {
    return require(`../../network-capabilities/network-capabilities-${stage}`);
  } catch (error) {
    console.error(
      `[network-capabilities] Failed to load network-capabilities-${stage}: ${error.message}`
    );
    return undefined;
  }
};

/**
 * Build the capabilities map for the current `NODE_ENV` stage.
 * @returns {Object<string, Object>|undefined} Map keyed by network id.
 *   Returns `undefined` when `NODE_ENV` is unsupported or the per-stage
 *   capabilities module fails to load (logs the cause).
 */
const get = () => {
  const capabilities = loadStage();
  if (!capabilities) return undefined;

  return NETWORKS.reduce(
    (object, network) => ({ ...object, [network.id]: check(capabilities, network) }),
    {}
  );
};

const isValidPowerupFlag = (flag) =>
  typeof flag?.enabled === 'boolean' &&
  (flag.reason === undefined || POWERUP_DISABLED_REASONS.includes(flag.reason));

/**
 * The stage's `powerups` block: `{ [id]: { enabled, reason? } }`, validated.
 * A typo must never ship as "enabled: false with no reason", so an entry with
 * a non-boolean `enabled` or a reason outside `POWERUP_DISABLED_REASONS`
 * fails the whole block (logged, `undefined` → the catalog answers 503),
 * the same posture as an unsupported `NODE_ENV`.
 * @returns {Object<string, { enabled: boolean, reason?: string }>|undefined}
 */
const getPowerups = () => {
  const capabilities = loadStage();
  if (!capabilities) return undefined;

  const powerups = capabilities[POWERUPS_KEY] || {};
  const invalid = Object.keys(powerups).filter((id) => !isValidPowerupFlag(powerups[id]));
  if (invalid.length > 0) {
    console.error(
      `[network-capabilities] Invalid powerups config for ${invalid.join(', ')}: ` +
        `expected { enabled: boolean, reason?: ${POWERUP_DISABLED_REASONS.join(' | ')} }`
    );
    return undefined;
  }
  return powerups;
};

module.exports = { get, getPowerups, POWERUP_DISABLED_REASONS, SUPPORTED_STAGES };
