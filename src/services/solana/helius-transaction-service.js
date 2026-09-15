'use strict';

/**
 * Helius transaction service.
 *
 * Thin wrapper over Helius Enhanced Transactions API and DAS API. Used by
 * `helius-provider.js` as the fallback path when Triton One is unavailable
 * or unconfigured.
 *
 * Docs:
 * - Enhanced Transactions: https://www.helius.dev/docs/enhanced-transactions
 * - DAS API:               https://www.helius.dev/docs/das-api
 */

const http = require('axios');
const { buildEnhancedApiUrl, getRpcUrl } = require('../../infrastructure/helius-client');
const { providerCall } = require('../../infrastructure/providers/provider-client');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Runs one Helius HTTP call through `providerCall` (budget, breaker, shared
 * limiter, retry) and unwraps `response.data`.
 * @param {string} operationName - label for retry logs.
 * @param {(ctx: {timeout: number, signal: AbortSignal}) => Promise<import('axios').AxiosResponse>} send
 * @param {string} [environment] - breaker scope.
 * @returns {Promise<*>} the response body.
 */
const request = async (operationName, send, environment) => {
  const response = await providerCall('helius', send, { operationName, environment });
  return response.data;
};

/**
 * Maps a DAS asset `content` block to the `{name, symbol, image}` shape
 * the NFT metadata readers return.
 */
const toNftMetadata = ({ metadata, links }) => ({
  name: metadata?.name || null,
  symbol: metadata?.symbol || null,
  image: links?.image || null,
});

/**
 * Fetch one or more parsed transactions from the Helius Enhanced API.
 * @param {string|string[]} signatures
 * @param {string} [environment='mainnet']
 * @returns {Promise<Object|Object[]>} A single tx if one signature was
 *   passed, otherwise the array of parsed txs.
 * @throws {Error} `Enhanced API not supported for environment: <environment>`
 *   when the environment is not covered by the Helius Enhanced API.
 */
const getEnhancedTransactions = async (signatures, environment = 'mainnet') => {
  const isArray = Array.isArray(signatures);
  const transactionArray = isArray ? signatures : [signatures];
  const url = buildEnhancedApiUrl(environment, '/v0/transactions');

  // null URL = environment not supported by Helius Enhanced API
  if (!url) {
    throw new Error(`Enhanced API not supported for environment: ${environment}`);
  }

  const data = await request(
    'Helius getEnhancedTransactions',
    ({ timeout, signal }) =>
      http.post(
        url,
        { transactions: transactionArray },
        { headers: JSON_HEADERS, timeout: Math.min(10000, timeout), signal }
      ),
    environment
  );

  // Single-signature input → return the single object, not the wrapping array.
  return isArray ? data : data[0];
};

/**
 * Fetch the parsed transaction history for an address.
 * @param {string} address
 * @param {Object} [filters={}]
 * @param {string} [filters.before] - Last signature of the previous page
 * @param {number} [filters.limit=10] - Max 100 per Helius
 * @param {string} [filters.type] - Tx type filter (TRANSFER, NFT_SALE, ...)
 * @param {string} [environment='mainnet']
 * @returns {Promise<{data: Array, meta: {nextPageToken?: string}}>}
 * @throws {Error} `Enhanced API not supported for environment: <environment>`
 *   when `getEnhancedTransactionsUrl(environment)` returns null (environment is
 *   not covered by the Helius Enhanced API).
 */
const getEnhancedTransactionHistory = async (address, filters = {}, environment = 'mainnet') => {
  const { before, limit = 10, type } = filters;

  let path = `/v0/addresses/${address}/transactions?limit=${limit}`;

  if (before) {
    path += `&before=${before}`;
  }

  if (type) {
    path += `&type=${type}`;
  }

  const url = buildEnhancedApiUrl(environment, path);

  // null URL = environment not supported by Helius Enhanced API
  if (!url) {
    throw new Error(`Enhanced API not supported for environment: ${environment}`);
  }

  const data = await request(
    'Helius getEnhancedTransactionHistory',
    ({ timeout, signal }) =>
      http.get(url, { headers: JSON_HEADERS, timeout: Math.min(10000, timeout), signal }),
    environment
  );

  return {
    data: data || [],
    meta: {
      nextPageToken: data?.length > 0 ? data[data.length - 1]?.signature : undefined,
    },
  };
};

/**
 * True if Helius classified this transaction (any non-UNKNOWN `type`).
 * Helius parses NFTs, aggregator routes, SPL transfers, and many DeFi protocols.
 * @param {Object} transaction
 * @returns {boolean}
 */
const isTransactionParsed = (transaction) => {
  return Boolean(transaction?.type && transaction.type !== 'UNKNOWN');
};

/**
 * Fetch a single NFT's metadata via Helius DAS API.
 * @param {string} mint
 * @param {string} [environment='mainnet']
 * @returns {Promise<{name, symbol, image}|null>}
 */
const getNftMetadata = async (mint, environment = 'mainnet') => {
  try {
    const url = getRpcUrl(environment);

    const data = await request(
      'Helius getNftMetadata',
      ({ timeout, signal }) =>
        http.post(
          url,
          { jsonrpc: '2.0', id: 'nft-metadata', method: 'getAsset', params: { id: mint } },
          { headers: JSON_HEADERS, timeout: Math.min(5000, timeout), signal }
        ),
      environment
    );

    if (data?.result?.content) {
      return toNftMetadata(data.result.content);
    }

    return null;
  } catch (error) {
    console.warn(`Failed to fetch NFT metadata for ${mint}: ${error.message}`);
    return null;
  }
};

/**
 * Fetch metadata for multiple NFTs in a single Helius DAS getAssetBatch call.
 * @param {string[]} mints
 * @param {string} [environment='mainnet']
 * @returns {Promise<Map<string, {name, symbol, image}>>}
 */
const getNftMetadataBatch = async (mints, environment = 'mainnet') => {
  const results = new Map();

  if (!mints || mints.length === 0) {
    return results;
  }

  try {
    const url = getRpcUrl(environment);

    const data = await request(
      'Helius getNftMetadataBatch',
      ({ timeout, signal }) =>
        http.post(
          url,
          {
            jsonrpc: '2.0',
            id: 'nft-metadata-batch',
            method: 'getAssetBatch',
            params: { ids: mints },
          },
          { headers: JSON_HEADERS, timeout: Math.min(10000, timeout), signal }
        ),
      environment
    );

    if (data?.result && Array.isArray(data.result)) {
      data.result.forEach((asset) => {
        if (asset?.id && asset?.content) {
          results.set(asset.id, toNftMetadata(asset.content));
        }
      });
    }
  } catch (error) {
    console.warn(`Failed to fetch NFT metadata batch: ${error.message}`);
  }

  return results;
};

module.exports = {
  getEnhancedTransactions,
  getEnhancedTransactionHistory,
  isTransactionParsed,
  getNftMetadata,
  getNftMetadataBatch,
};
