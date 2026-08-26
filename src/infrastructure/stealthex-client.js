'use strict';

/**
 * StealthEX HTTP client (API v4).
 *
 * Authenticates with the header-based scheme the provider recommends for v4,
 * so credentials never travel in a URL and cannot end up in anything that
 * records one.
 */

const http = require('axios');

const BASE_URL = process.env.STEALTHEX_URL || 'https://api.stealthex.io';
const REQUEST_TIMEOUT = 15000;

/**
 * Issues a request against the v4 API.
 *
 * @param {Object} options
 * @param {string} options.url - Path starting with `/v4/...`.
 * @param {string} [options.method='get']
 * @param {Object} [options.params] - Query parameters.
 * @param {Object} [options.data] - JSON body.
 * @returns {Promise<any>} The response body.
 */
const request = async ({ url, method = 'get', params, data }) => {
  const response = await http({
    method,
    url: `${BASE_URL}${url}`,
    params,
    data,
    timeout: REQUEST_TIMEOUT,
    headers: { Authorization: `Bearer ${process.env.STEALTHEX_API_KEY}` },
  });

  return response.data;
};

/**
 * Logs an upstream failure with normalized context.
 *
 * The reason is read from `err.details`, which is where StealthEX puts it in
 * its `{err: {kind, details}}` envelope. A rejection caused by the caller's
 * own input (400/404/422) logs as a warning: at error level every mistyped
 * amount reads as a backend incident.
 *
 * @param {string} operation
 * @param {Error} error
 * @param {Object} [context]
 * @returns {void}
 */
const logError = (operation, error, context = {}) => {
  const status = error.response?.status;
  const record = {
    ...context,
    status,
    statusText: error.response?.statusText,
    kind: error.response?.data?.err?.kind,
    reason: error.response?.data?.err?.details || error.response?.data?.message || error.message,
    timestamp: new Date().toISOString(),
  };

  if (status >= 400 && status < 500) {
    console.warn(`[StealthEX] ${operation} rejected:`, record);
    return;
  }

  console.error(`[StealthEX] ${operation} failed:`, record);
};

/**
 * The `kind` StealthEX returned, when it sent its error envelope.
 * @param {Error} error
 * @returns {string|undefined}
 */
const errorKind = (error) => error?.response?.data?.err?.kind;

module.exports = { request, logError, errorKind, BASE_URL, REQUEST_TIMEOUT };
