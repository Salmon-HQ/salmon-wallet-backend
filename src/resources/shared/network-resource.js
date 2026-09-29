'use strict';

/**
 * Network resource — public response shape for `/v1/networks`. Decorates
 * each entry with stage-derived `enabled` + `sections` flags and the
 * `powerups` list (`[]` when none) merged in by `network-catalog-service`. Consumed by the network controller.
 *
 * `config` is emitted through an explicit allow-list. The internal
 * `config.nodeUrl` carries the Solana provider credential — Triton's token as
 * a path segment, Helius's as `?api-key=` — and this response is anonymous
 * and cacheable, so that value stays server-side in `res.locals.network.config`
 * and clients receive the credential-free `publicNodeUrl` under the same key.
 */

/** Config keys safe to publish verbatim; none of them can hold a secret. */
const PUBLIC_CONFIG_KEYS = ['chainId', 'rpcUrl', 'apiUrl'];

const publicConfig = (config = {}) => {
  const published = Object.fromEntries(
    PUBLIC_CONFIG_KEYS.filter((key) => config[key] !== undefined).map((key) => [key, config[key]])
  );

  if (config.publicNodeUrl) published.nodeUrl = config.publicNodeUrl;

  return published;
};

const decorateNetwork = (network) => ({
  id: network.id,
  blockchain: network.blockchain,
  environment: network.environment,
  name: network.name,
  icon: network.icon,
  currency: network.currency,
  config: publicConfig(network.config),
  enabled: Boolean(network.enabled),
  sections: network.sections || {},
  powerups: network.powerups || [],
  attribution: network.attribution || null,
});

module.exports = decorateNetwork;
