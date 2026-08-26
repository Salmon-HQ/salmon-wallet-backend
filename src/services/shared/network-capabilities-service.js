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
const NETWORKS = require('../../constants/networks');

const SUPPORTED_STAGES = ['develop', 'local', 'main', 'prod'];

/**
 * Recursively evaluate a capabilities rule tree against `network`.
 * A leaf rule matches when it is `'*'` or equals the network's `id`/`blockchain`
 * (string form), or when it is an array containing either (array form).
 * Nested objects are walked recursively so a capability can have sub-flags
 * (e.g. `sections.swap`).
 * @param {Object} values - Rule tree (from `network-capabilities-<stage>.js`).
 * @param {Object} network - Network descriptor with `id` and `blockchain`.
 * @returns {Object} Same shape as `values`, with every leaf resolved to a boolean.
 */
const check = (values, network) => {
  return mapValues(values, (value) => {
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
 * Build the capabilities map for the current `NODE_ENV` stage.
 * @returns {Object<string, Object>|undefined} Map keyed by network id.
 *   Returns `undefined` when `NODE_ENV` is unsupported or the per-stage
 *   capabilities module fails to load (logs the cause).
 */
const get = () => {
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
    const capabilities = require(`../../network-capabilities/network-capabilities-${stage}`);

    return NETWORKS.reduce(
      (object, network) => ({ ...object, [network.id]: check(capabilities, network) }),
      {}
    );
  } catch (error) {
    console.error(
      `[network-capabilities] Failed to load network-capabilities-${stage}: ${error.message}`
    );
    return undefined;
  }
};

module.exports = { get, SUPPORTED_STAGES };
