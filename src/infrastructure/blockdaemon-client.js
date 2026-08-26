'use strict';

/**
 * Blockdaemon client — centralized config for Blockdaemon's Universal
 * API and native RPC endpoint.
 *
 * Env reads are lazy so tests and runtime env changes are observed without
 * reloading this module.
 */

const BASE_URL = 'https://svc.blockdaemon.com';

const getApiKey = () => process.env.UBIQUITY_API_KEY;

/**
 * Auth header for Blockdaemon requests.
 * @returns {{'X-API-Key': string|undefined}}
 */
const getHeaders = () => ({
  'X-API-Key': getApiKey(),
});

/**
 * Build a Blockdaemon Universal API URL for the network in `locals` (e.g.
 * balances, transaction history).
 * @param {{network: {blockchain: string, environment: string}}} locals - per-request network context.
 * @param {string} resource - path suffix appended after `/universal/v1/{blockchain}/{environment}`, e.g. `/account/{address}`.
 * @returns {string} Full request URL.
 */
const getUniversalUrl = (locals, resource) => {
  const { blockchain, environment } = locals.network;
  return `${BASE_URL}/universal/v1/${blockchain}/${environment}${resource}`;
};

/**
 * Build an axios request config with the `X-API-Key` header attached.
 * @param {{timeout?: number, params?: Object}} [options]
 * @returns {{headers: {'X-API-Key': string|undefined}, params: Object|undefined, timeout: number|undefined}}
 */
const getRequestConfig = ({ timeout, params } = {}) => ({
  headers: getHeaders(),
  params,
  timeout,
});

module.exports = {
  getUniversalUrl,
  getHeaders,
  getRequestConfig,
};
