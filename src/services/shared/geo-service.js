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
 * The address must be passed. Asked without one, ip-api.com geolocates the
 * TCP source it observes — which, called from the Lambda, is the Lambda's own
 * egress address, so every caller would receive the service's location and
 * outbound identity rather than their own.
 *
 * @param {string} [clientIp] - The caller's public address. Omitted only when
 *   it cannot be resolved, in which case the answer describes this service.
 * @returns {Promise<object>} The ip-api.com JSON payload (country, query, etc.).
 * @throws {Error} Propagates any upstream/network error to the caller.
 */
const getCallerGeo = async (clientIp) => {
  const url = clientIp ? `${IP_API_URL}/${encodeURIComponent(clientIp)}` : IP_API_URL;
  const { data } = await http.get(url, { timeout: REQUEST_TIMEOUT_MS });
  return data;
};

module.exports = { getCallerGeo };
