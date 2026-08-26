'use strict';

/**
 * Trustwallet asset registry wrapper.
 *
 * Fetches the per-blockchain `tokenlist.json` from Trustwallet's public
 * assets CDN and exposes the native chain logo URL. Token lists are
 * cached through `trustwallet-repository`.
 */

const http = require('axios');
const repository = require('../../repositories/shared/trustwallet-repository');

const BASE_URL = 'https://assets-cdn.trustwallet.com/blockchains';

/**
 * Return the Trustwallet token list for the given blockchain. Cached
 * results are served when available; otherwise the upstream JSON is
 * fetched and persisted before returning.
 * @param {string} blockchain - Trustwallet blockchain slug (e.g. `ethereum`).
 * @param {Object} locals - Request locals (used by the cache repository).
 * @returns {Promise<Array<Object>>} Trustwallet token entries.
 */
const listTokens = async (blockchain, locals) => {
  const cachedTokens = await repository.getTokens(blockchain, locals);
  if (cachedTokens) {
    return cachedTokens;
  }

  const { data } = await http.get(`${BASE_URL}/${blockchain}/tokenlist.json`);

  const { tokens } = data;

  await repository.saveTokens(blockchain, tokens, locals);

  return tokens;
};

/**
 * Build the public CDN URL of the native asset's logo for the given
 * blockchain (no network call).
 * @param {string} blockchain
 * @returns {string}
 */
const getNativeLogo = (blockchain) => `${BASE_URL}/${blockchain}/info/logo.png`;

module.exports = { listTokens, getNativeLogo };
