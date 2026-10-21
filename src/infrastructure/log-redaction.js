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

const { maskUrl } = require('../../packages/middleware/logger/mask-url');
const tritonClient = require('./triton-client');

const RPCPOOL_TOKEN = /(\.rpcpool\.com)\/[A-Za-z0-9_-]{8,}/gi;
const QUERY_CREDENTIAL = /([?&][\w-]*(?:api[-_]?key|api_secret)=)[^&\s]+/gi;
const HEADER_CREDENTIAL = /([\w-]*(?:api[-_]?key|api_secret)['"]?\s*:\s*['"]?)[^\s'",;}]+/gi;

/**
 * Replaces the credentials this backend's providers use with `[REDACTED]`:
 * - the `TRITON_API_TOKEN` value, anywhere;
 * - the path segment after an `.rpcpool.com` host (the Triton token embedded
 *   in `TRITON_RPC_URL`, which `TRITON_API_TOKEN` never sees);
 * - query values named `*api-key`, `*api_key`, `*apikey` or `*api_secret`
 *   (Helius, CoinGecko, the GA4 Measurement Protocol);
 * - header-style text `<name>api-key: <value>`, as in a raw request
 *   (`x-cg-pro-api-key`, `x-api-key`, `0x-api-key`) or an inspected object.
 *
 * It is not a general scrubber: any other credential shape passes through,
 * so log a reduced view (`toSafeError`), never a raw object, and rely on this
 * for free text only.
 *
 * @param {*} value
 * @returns {*} The string with those credentials replaced; non-strings unchanged.
 */
const redact = (value) => {
  if (typeof value !== 'string' || !value) return value;
  let safe = value;
  const token = tritonClient.getApiToken();
  if (token) safe = safe.split(token).join('[REDACTED]');
  return safe
    .replace(RPCPOOL_TOKEN, '$1/[REDACTED]')
    .replace(QUERY_CREDENTIAL, '$1[REDACTED]')
    .replace(HEADER_CREDENTIAL, '$1[REDACTED]');
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
 * Origin and path of a request URL, with the Triton token redacted and wallet
 * addresses trimmed. The query is dropped: it carries `?api-key=` credentials
 * and caller input.
 * @param {string|undefined} url
 * @returns {string|undefined}
 */
const toLoggableUrl = (url) => {
  if (!url) return undefined;
  try {
    const { origin, pathname } = new URL(url);
    return maskUrl(redact(`${origin}${pathname}`));
  } catch {
    return undefined;
  }
};

/** Text of whatever was thrown: an Error's message, a thrown string, or its String() form. */
const describeThrown = (error) => {
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') return error.message;
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
};

/**
 * Credential-free view of anything caught, safe to hand to `console.*`.
 * @param {*} error
 * @returns {{name?: string, message: string, code?: string, status?: number, method?: string, url?: string, stack?: string}}
 */
const toSafeError = (error) => ({
  name: error?.name,
  message: redact(describeThrown(error)),
  code: error?.code,
  status: error?.response?.status,
  method: error?.config?.method?.toUpperCase(),
  url: toLoggableUrl(error?.config?.url),
  stack: redact(error?.stack),
});

/**
 * Makes a caught error safe to rethrow where something else logs it whole,
 * such as the Lambda runtime, which logs a rejected invocation with
 * JSON.stringify and so prints an axios error's request. Removes `config`,
 * `request` and `response` and redacts `message` and `stack` in place; an
 * error that cannot be changed (frozen, sealed) or a thrown non-object comes
 * back as a new Error with the redacted message.
 * @param {*} error
 * @returns {Object} `error` itself, or a new Error.
 */
const withoutCredentials = (error) => {
  if (error && typeof error === 'object') {
    try {
      delete error.config;
      delete error.request;
      delete error.response;
      if (typeof error.message === 'string') error.message = redact(error.message);
      if (typeof error.stack === 'string') error.stack = redact(error.stack);
      return error;
    } catch {
      // Frozen or sealed: fall through to a copy.
    }
  }
  const { name, message } = toSafeError(error);
  const copy = new Error(message);
  if (typeof name === 'string') copy.name = name;
  return copy;
};

module.exports = { redact, toOrigin, toSafeError, withoutCredentials };
