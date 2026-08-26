'use strict';

/**
 * Caller geolocation service.
 *
 * Resolves geolocation info for the caller's public IP via ip-api.com.
 * Used by the unversioned `GET /ip` info endpoint.
 */

const http = require('axios');

const IP_API_URL = 'http://ip-api.com/json';
// ip-api answers in well under a second; a hung upstream must not pin the
// Lambda for a minute per /ip call.
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Fetch geolocation info for the caller's IP from ip-api.com.
 *
 * @returns {Promise<object>} The ip-api.com JSON payload (country, query, etc.).
 * @throws {Error} Propagates any upstream/network error to the caller.
 */
const getCallerGeo = async () => {
  const { data } = await http.get(IP_API_URL, { timeout: REQUEST_TIMEOUT_MS });
  return data;
};

module.exports = { getCallerGeo };
