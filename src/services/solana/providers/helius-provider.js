'use strict';

/**
 * HeliusProvider — implements SolanaDataProvider against Helius Enhanced
 * Transactions API + Helius DAS RPC. Pure delegation to existing helius-*
 * modules; no behavior change vs the pre-abstraction code.
 *
 * After Triton migration, this provider stays alive as the fallback in the
 * resolver. It must keep the same canonical return shape as TritonProvider so
 * the resolver can swap between them transparently.
 */

const axios = require('axios');
const { Connection } = require('@solana/web3.js');

const { getRpcUrl } = require('../../../infrastructure/helius-client');
const {
  withRetry,
  rateLimiter,
} = require('../../../infrastructure/rate-limiting/helius-rate-limiter');

const {
  getEnhancedTransactions,
  getEnhancedTransactionHistory,
  isTransactionParsed,
  getNftMetadata,
  getNftMetadataBatch,
} = require('../helius-transaction-service');

const {
  transformDasAsset,
  fetchToken2022NftsByOwner,
  paginateNfts,
  getPagination,
} = require('./das-shared');

const NAME = 'helius';

/**
 * DAS getAssetsByOwner against the Helius RPC URL configured for the network.
 *
 * @param {string} nodeUrl - Helius RPC URL.
 * @param {string} ownerAddress - Owner pubkey to fetch DAS assets for.
 * @returns {Promise<Array<Object>>} Raw DAS asset items (`response.data.result.items`),
 *   or an empty array when the response is missing the expected shape.
 */
const fetchDasAssetsByOwner = async (nodeUrl, ownerAddress) => {
  const response = await withRetry(
    async () => {
      await rateLimiter.waitAndConsume();
      return axios.post(
        nodeUrl,
        {
          jsonrpc: '2.0',
          id: 'get-nfts-by-owner',
          method: 'getAssetsByOwner',
          params: {
            ownerAddress,
            page: 1,
            limit: 1000,
            displayOptions: { showFungible: false },
          },
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
      );
    },
    { operationName: 'Helius DAS getAssetsByOwner' }
  );

  return response.data?.result?.items || [];
};

/**
 * DAS getAsset for a single mint against the Helius RPC URL configured for
 * the network.
 *
 * @param {string} nodeUrl - Helius RPC URL.
 * @param {string} mintAddress - Mint to fetch DAS metadata for.
 * @returns {Promise<Object|undefined>} Raw DAS asset (`response.data.result`),
 *   or undefined when the response is missing the expected shape.
 */
const fetchDasAssetByMint = async (nodeUrl, mintAddress) => {
  const response = await withRetry(
    async () => {
      await rateLimiter.waitAndConsume();
      return axios.post(
        nodeUrl,
        {
          jsonrpc: '2.0',
          id: 'get-asset',
          method: 'getAsset',
          params: { id: mintAddress },
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
      );
    },
    { operationName: 'Helius DAS getAsset' }
  );

  return response.data?.result;
};

const provider = {
  name: NAME,

  getRpcUrl,

  getEnhancedTransactions,
  getEnhancedTransactionHistory,
  isTransactionParsed,

  getNftMetadata,
  getNftMetadataBatch,

  /**
   * Combines DAS getAssetsByOwner with Token-2022 NFT enumeration.
   * Mirrors the behavior previously inlined in solana-nft-repository.
   */
  async getNftsByOwner(publicKeyStr, options = {}, locals) {
    const { nodeUrl } = locals.network.config;
    const connection = new Connection(nodeUrl);
    const { limit, offset } = getPagination(options);

    // DAS errors propagate on purpose. Swallowing them returned an empty
    // list, which reaches the wallet as a successful "you own no NFTs" — and
    // it also hid the failure from the provider resolver, so the Triton ->
    // Helius fallback could never fire for this leg.
    const assets = await fetchDasAssetsByOwner(nodeUrl, publicKeyStr);
    const dasNfts = assets.map((asset) => transformDasAsset(asset, publicKeyStr));

    const token2022Nfts = await fetchToken2022NftsByOwner(connection, publicKeyStr);
    return paginateNfts([...dasNfts, ...token2022Nfts], limit, offset);
  },

  /**
   * DAS getAsset for a single mint.
   */
  async getNftByMint(mintAddress, locals) {
    const { nodeUrl } = locals.network.config;
    // `null` is reserved for "the indexer has no such asset", which the
    // caller turns into 404 nft_not_found. An indexer failure must not borrow
    // that meaning: telling the owner their NFT does not exist is worse than
    // telling them the lookup failed.
    const asset = await fetchDasAssetByMint(nodeUrl, mintAddress);
    if (!asset) return null;
    return transformDasAsset(asset, asset.ownership?.owner || null);
  },
};

module.exports = provider;
