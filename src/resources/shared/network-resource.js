'use strict';

/**
 * Network resource — public response shape for `/v1/networks`. Decorates
 * each entry with stage-derived `enabled` + `sections` flags merged in
 * by `network-catalog-service`. Consumed by the network controller.
 */

const decorateNetwork = (network) => ({
  id: network.id,
  blockchain: network.blockchain,
  environment: network.environment,
  name: network.name,
  icon: network.icon,
  currency: network.currency,
  config: network.config || {},
  enabled: Boolean(network.enabled),
  sections: network.sections || {},
});

module.exports = decorateNetwork;
