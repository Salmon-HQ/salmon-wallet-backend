'use strict';

const { normalizeIpfsUrl } = require('./content-urls');

/**
 * Resource decorator for the canonical Solana fungible-token shape used
 * by `/ft/verified` and `/ft/search`.
 *
 * Accepts entries in the Jupiter Tokens v2 shape (`id`, `icon`, no
 * coingeckoId) and the SPL Token Registry / CDN shape (`address`,
 * `logoURI`, `extensions.coingeckoId`). Jupiter v2 still resolves to
 * `coingeckoId: null` because v2 omits it; CDN-sourced tokens preserve
 * the value.
 *
 * The `logo` field is run through `normalizeIpfsUrl` so flaky IPFS
 * gateways (nftstorage.link, dweb.link subdomains, etc.) resolve to a
 * stable `ipfs.io` path before reaching the wallet — matching the
 * normalization already applied to NFT and transaction logos.
 *
 * @param {Object} token - Jupiter Tokens v2 entry or SPL Token
 *   Registry/CDN entry.
 * @returns {Promise<Object>} resource
 * @returns {number} resource.chainId - always `101` (Solana mainnet)
 * @returns {string} resource.address
 * @returns {string} resource.symbol
 * @returns {string} resource.name
 * @returns {number} resource.decimals
 * @returns {string|null} resource.logo
 * @returns {Array<string>} resource.tags
 * @returns {string|null} resource.coingeckoId
 */
module.exports = async (token) => {
  const address = token.id || token.address;
  const rawLogo = token.icon ?? token.logoURI ?? null;
  const logo = normalizeIpfsUrl(rawLogo) ?? null;
  const coingeckoId = token.coingeckoId ?? token.extensions?.coingeckoId ?? null;

  return {
    chainId: 101, // Solana mainnet chainId
    address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    logo,
    tags: token.tags || [],
    coingeckoId,
  };
};
