'use strict';

/**
 * Esplora client — Bitcoin chain data from the public Esplora REST API
 * (https://github.com/Blockstream/esplora/blob/master/API.md). Two
 * independent operators serve the same API: mempool.space first, then
 * blockstream.info when mempool.space is unreachable, times out or fails
 * with a 5xx. A 4xx is the caller's input (or an address the host refuses
 * to enumerate) and is the same answer on either host, so it is not retried.
 *
 * No credential: both hosts are public. The wallet broadcasts to the same two
 * hosts (`packages/shared/src/config/bitcoin-relays.ts` in the frontend).
 */

const http = require('axios');
const { providerCall } = require('./providers/provider-client');

const HOSTS = {
  mainnet: [
    { profile: 'mempool', baseUrl: 'https://mempool.space/api' },
    { profile: 'blockstream', baseUrl: 'https://blockstream.info/api' },
  ],
  testnet: [
    { profile: 'mempool', baseUrl: 'https://mempool.space/testnet/api' },
    { profile: 'blockstream', baseUrl: 'https://blockstream.info/testnet/api' },
  ],
};

const MAX_QUOTED_LENGTH = 200;

/**
 * Esplora answers errors as `text/plain` ("Invalid Bitcoin address"), which
 * the error handler only quotes from an object. A short plain sentence becomes
 * `{ message }`; anything else (HTML from a proxy, a long dump) becomes `{}`
 * so it is never echoed to the caller.
 */
const normaliseErrorBody = (error) => {
  const data = error?.response?.data;
  if (typeof data !== 'string') return error;
  const text = data.trim();
  error.response.data =
    text && text.length <= MAX_QUOTED_LENGTH && !text.includes('<') ? { message: text } : {};
  return error;
};

const isCallerError = (error) => {
  const status = error?.response?.status;
  return status >= 400 && status < 500 && status !== 429;
};

/**
 * GET `path` on the first host that answers.
 *
 * @param {string} path - e.g. `/address/<addr>/utxo`.
 * @param {{network: {environment: string}}} locals
 * @returns {Promise<*>} the parsed JSON body.
 * @throws the upstream error of the last host tried, or a 4xx unchanged.
 */
const get = async (path, locals) => {
  const hosts = HOSTS[locals.network.environment] || HOSTS.mainnet;
  let lastError;
  for (const { profile, baseUrl } of hosts) {
    try {
      const { data } = await providerCall(
        profile,
        ({ timeout, signal }) => http.get(`${baseUrl}${path}`, { timeout, signal }),
        { locals, operationName: `Esplora ${path.split('/')[1]} (${profile})` }
      );
      return data;
    } catch (error) {
      normaliseErrorBody(error);
      if (isCallerError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
};

module.exports = { get, HOSTS };
