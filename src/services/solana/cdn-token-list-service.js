'use strict';

/**
 * Solana Labs CDN token-list service.
 *
 * Acts as the last-resort fallback for `solana-ft-service.getVerified`
 * when Jupiter Tokens v2 fails. Fetches the canonical SPL Token Registry
 * list shipped on jsDelivr and normalizes each entry to the Jupiter v2
 * shape expected by `solana-ft-batch-resource`, so the response shape is
 * provider-agnostic.
 */

const http = require('axios');

const CDN_TOKEN_LIST_URL =
  'https://cdn.jsdelivr.net/gh/solana-labs/token-list@latest/src/tokens/solana.tokenlist.json';
const CDN_TIMEOUT_MS = 10000;

/**
 * Map a single SPL Token Registry entry to the Jupiter v2 canonical shape
 * used by `solana-ft-batch-resource`.
 *
 * @param {Object} entry
 * @returns {Object}
 */
const normalizeCdnEntry = (entry) => ({
  id: entry.address,
  symbol: entry.symbol,
  name: entry.name,
  decimals: entry.decimals,
  icon: entry.logoURI || null,
  tags: Array.isArray(entry.tags) ? entry.tags : [],
  coingeckoId: entry.extensions?.coingeckoId || null,
});

/**
 * Fetch the verified-token list from the Solana Labs CDN. Single-shot
 * request — Jupiter already retries upstream; retrying the CDN in the
 * same request only adds latency.
 *
 * @returns {Promise<Object[]>} Tokens in Jupiter v2 canonical shape.
 */
const getVerifiedTokens = async () => {
  const { data } = await http.get(CDN_TOKEN_LIST_URL, { timeout: CDN_TIMEOUT_MS });

  const list = Array.isArray(data?.tokens) ? data.tokens : [];
  return list
    .filter((entry) => entry && entry.address && entry.symbol && entry.name)
    .map(normalizeCdnEntry);
};

module.exports = { getVerifiedTokens, CDN_TOKEN_LIST_URL };
