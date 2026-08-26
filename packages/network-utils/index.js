'use strict';

const { stringify } = require('qs');

const resolveClientIp = (req) => {
  if (req.ips?.length > 0) {
    return req.ips[0];
  }
  if (req.connection?.remoteAddress) {
    const ips = req.connection.remoteAddress.split(',');
    if (ips.length > 0) {
      return ips[0].trim();
    }
  }
  return undefined;
};

const BASE64_REPLACE = { '+': '-', '/': '_', '=': '' };

/**
 * Convert base64 strings to URL safe base64 strings.
 *
 * @param {string} string
 * @return {string}
 */
const urlsafe = (string) => string.replace(/[+/=]/g, (c) => BASE64_REPLACE[c]);

/**
 * Convert an integer to a URL safe base64 string.
 *
 * @param {number} number
 * @return {string}
 */
const intToBytes = (number) => urlsafe(Buffer.from(number.toString()).toString('base64'));

/**
 * Convert a URL safe base64 string to an integer.
 *
 * @param {string} string
 * @return {number}
 */
const bytesToInt = (string) => parseInt(Buffer.from(string, 'base64').toString(), 10);

/**
 * Axios parameters serializer
 *
 * @param {object} params
 * @returns {string}
 */
const paramsSerializer = (params) => {
  if (params) {
    const keys = Object.keys(params);
    for (const key of keys) {
      const value = params[key];
      if (Array.isArray(value) && value.length === 0) {
        params[key] = [''];
      }
    }
  }

  return stringify(params, { arrayFormat: 'brackets' });
};

module.exports = {
  resolveClientIp,
  urlsafe,
  intToBytes,
  bytesToInt,
  paramsSerializer,
};
