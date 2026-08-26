'use strict';

const { getCacheKeyFor, getFromCache, storeInCache } = require('../helper');
const solanaProvider = require('../../services/solana/providers');

const ttl = 3600;

/**
 * NFT repository — delegates DAS calls to the configured Solana data provider
 * (Triton primary, Helius fallback). The provider transforms DAS responses
 * into the wallet-canonical NFT shape and combines DAS results with
 * Token-2022 enumeration.
 *
 * Cache key + TTL behavior is preserved from the previous direct-DAS impl.
 */

/**
 * NFTs owned by a wallet — delegates to the configured Solana data
 * provider's DAS `getAssetsByOwner` (combined with Token-2022
 * enumeration). Not cached at this layer.
 *
 * @param {string} publicKeyStr - owner wallet address.
 * @param {{limit?: number, offset?: number}} options
 * @param {object} locals
 * @returns {Promise<{data: object[], pagination: object}>}
 */
const findByOwner = async (publicKeyStr, options, locals) => {
  return solanaProvider.getNftsByOwner(publicKeyStr, options, locals);
};

/**
 * Fetch a single NFT directly from the provider (DAS `getAsset`), bypassing
 * the cache. Used by {@link findByAddress} on a cache miss.
 *
 * @param {string} mintAddress
 * @param {object} locals
 * @returns {Promise<object|null>} wallet-canonical NFT shape, or `null`
 *   when the asset cannot be resolved.
 */
const findFromSourceWithMint = async (mintAddress, locals) => {
  return solanaProvider.getNftByMint(mintAddress, locals);
};

/**
 * NFT by mint address, cache-first (1h TTL, network-scoped key). Falls
 * back to {@link findFromSourceWithMint} on a miss and populates the
 * cache when the provider returns a result.
 *
 * @param {string} mintAddress
 * @param {object} locals
 * @returns {Promise<object|null>} wallet-canonical NFT shape, or `null`
 *   when the asset cannot be resolved.
 */
const findByAddress = async (mintAddress, locals) => {
  const key = getCacheKeyFor('solana-nfts', 'mintAddress', mintAddress, locals);

  let result = await getFromCache(key);
  if (result) {
    return result;
  }

  result = await findFromSourceWithMint(mintAddress, locals);
  if (result) {
    await storeInCache(key, result, ttl);
  }
  return result;
};

module.exports = {
  findByOwner,
  findByAddress,
  findFromSourceWithMint,
};
