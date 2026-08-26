'use strict';

/**
 * Scam URL list service.
 *
 * Fetches the per-blockchain Phantom Labs blocklist (YAML) and serves it
 * to clients so the wallet can warn users before they interact with a
 * known-malicious dApp. Results are cached via `scam-repository`.
 */

const http = require('axios');
const { load } = require('js-yaml');
const repository = require('../../repositories/shared/scam-repository');
const { SOLANA, ETHEREUM } = require('../../constants/blockchains');

const BLACKLIST_URL = {
  [SOLANA]: 'https://raw.githubusercontent.com/phantom-labs/blocklist/master/blocklist.yaml',
  [ETHEREUM]: 'https://raw.githubusercontent.com/phantom-labs/blocklist/master/eth-blocklist.yaml',
};

/**
 * Return the list of blocklisted URLs for the given blockchain.
 * Reads from cache when available; otherwise fetches the upstream YAML,
 * normalises entries to lowercase, and writes the result back to the cache.
 * @param {string} blockchain - One of the supported blockchain ids.
 * @param {Object} locals - Request locals (used by the cache repository).
 * @returns {Promise<string[]>} Lowercased URL list. Empty if unsupported.
 */
const listUrls = async (blockchain, locals) => {
  const blacklistUrl = BLACKLIST_URL[blockchain];
  if (!blacklistUrl) {
    return [];
  }

  const cachedUrls = await repository.getUrls(blockchain, locals);
  if (cachedUrls) {
    return cachedUrls;
  }

  const { data } = await http.get(blacklistUrl, { timeout: 30000 });
  const urls = load(data).map(({ url }) => url.toLowerCase());

  await repository.saveUrls(blockchain, urls, locals);

  return urls;
};

module.exports = { listUrls };
