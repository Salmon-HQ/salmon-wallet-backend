'use strict';

/**
 * Keeps provider credentials out of CloudWatch.
 *
 * Providers carry their credential in three places: a request header
 * (CoinGecko `x-cg-*-api-key`, 0x, Jupiter), the URL path (Triton puts its
 * token after `.rpcpool.com/`) or a query parameter (`?api-key=`). A raw
 * axios error holds all three on `config` and `request`, and Node's inspector
 * prints them, so a caught provider error is logged through `toSafeError`,
 * never as the error object, and a provider URL through `toOrigin`.
 */

const tritonClient = require('./triton-client');

/**
 * Removes the Triton token and any `api-key` query value from a string.
 * @param {*} value
 * @returns {*} The string with credentials replaced by `[REDACTED]`;
 *   non-strings unchanged.
 */
const redact = (value) => {
  if (typeof value !== 'string' || !value) return value;
  let safe = value;
  const token = tritonClient.getApiToken();
  if (token) safe = safe.split(token).join('[REDACTED]');
  // Covers a token embedded in TRITON_RPC_URL, which getApiToken never sees.
  safe = safe.replace(/(\.rpcpool\.com)\/[A-Za-z0-9_-]{8,}/g, '$1/[REDACTED]');
  return safe.replace(/([?&]api[-_]?key=)[^&\s]+/gi, '$1[REDACTED]');
};

/**
 * Reduces a URL to its origin: which provider was called is the whole
 * diagnostic value, while the path and query are where Triton and Helius put
 * their credential.
 * @param {string|undefined} url
 * @returns {string|undefined}
 */
const toOrigin = (url) => {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/**
 * Credential-free view of a caught error, safe to hand to `console.*`.
 * @param {Error} error
 * @returns {{message?: string, code?: string, status?: number, method?: string, url?: string}}
 */
const toSafeError = (error) => ({
  message: redact(error?.message),
  code: error?.code,
  status: error?.response?.status,
  method: error?.config?.method?.toUpperCase(),
  url: toOrigin(error?.config?.url),
});

module.exports = { redact, toOrigin, toSafeError };
