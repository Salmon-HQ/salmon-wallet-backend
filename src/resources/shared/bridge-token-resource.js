'use strict';

/**
 * Bridge token resource — public response shape for a StealthEX-supported
 * currency.
 *
 * The wire shape is unchanged from the v2 era; only its sources moved. Chain
 * resolution and the native-network rule live in `stealthex-catalogue`,
 * because the service needs them too and duplicating that table is how the
 * two copies drift.
 *
 * Two fields are deliberately null: v4 has no per-currency explorer URLs (it
 * exposes them per exchange instead). The keys stay, because dropping a key is
 * a wire change while nulling a value is not, and nothing in the wallet reads
 * either one.
 */

const { resolveChain, publicNetwork } = require('../../services/shared/stealthex-catalogue');

/**
 * @param {Object} currency - v4 catalogue record.
 * @returns {Promise<Object>} resource
 * @returns {string} resource.symbol - the v2-era ticker (`usdcsol`, `ethbase`),
 *   which stays the public vocabulary; v4's own `symbol` is not unique.
 * @returns {string} resource.name
 * @returns {string|null} resource.network - null for a chain's native currency
 * @returns {string|null} resource.chain - canonical chain id
 * @returns {boolean} resource.has_extra_id
 * @returns {string|null} resource.extra_id
 * @returns {Array} resource.warnings_from
 * @returns {Array} resource.warnings_to
 * @returns {string|null} resource.validation_address
 * @returns {string|null} resource.validation_extra
 * @returns {null} resource.address_explorer - no v4 equivalent
 * @returns {null} resource.tx_explorer - no v4 equivalent
 * @returns {string|null} resource.logo
 */
const decorate = async (currency, _include, _key, _context) => {
  const {
    legacy_symbol,
    symbol,
    name,
    extra_id,
    address_regex,
    extra_id_regex,
    warnings,
    icon_url,
  } = currency;

  return {
    symbol: legacy_symbol || symbol,
    name,
    network: publicNetwork(currency),
    chain: resolveChain(currency),
    has_extra_id: Boolean(extra_id),
    extra_id: extra_id ?? null,
    warnings_from: warnings?.deposit || [],
    warnings_to: warnings?.withdrawal || [],
    validation_address: address_regex ?? null,
    validation_extra: extra_id_regex ?? null,
    address_explorer: null,
    tx_explorer: null,
    logo: icon_url ?? null,
  };
};

module.exports = decorate;
module.exports.resolveChain = resolveChain;
