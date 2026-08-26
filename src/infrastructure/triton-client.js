'use strict';

/**
 * Triton One client — centralized config for the Triton Solana RPC + DAS
 * endpoints.
 *
 * Auth model (per https://docs.triton.one): Triton appends the secret token
 * as a **path segment**:
 *   https://<tenant>.solana-mainnet.rpcpool.com/<your-secret-token>
 *
 * That is different from Helius (`?api-key=...`). To support both styles we
 * detect what the user provided:
 *
 *   1. URL already includes the token (path segment under `.rpcpool.com/`
 *      or any query string) → use the URL as-is, ignore TRITON_API_TOKEN.
 *   2. Bare base URL (no path, no query) + TRITON_API_TOKEN set → append
 *      `/<token>` as a path segment (Triton convention).
 *   3. Bare base URL + no token → use as-is (caller will hit a 401/403).
 *
 * For testnet we fall through to the public Solana RPC; Triton does not host
 * testnet on the standard tier.
 *
 * Env reads are lazy: each call hits `process.env` so tests that mutate env
 * (and prod toggles like AWS Lambda extensions) are observed without a
 * `jest.resetModules()` dance.
 */

const PUBLIC_TESTNET = 'https://api.testnet.solana.com';
const PUBLIC_DEVNET = 'https://api.devnet.solana.com';

const RPCPOOL_HOST_RE = /\.rpcpool\.com/;

/** Raw `TRITON_API_TOKEN` env value, or `''` when unset. */
const getApiToken = () => process.env.TRITON_API_TOKEN || '';
const getMainnetRpcUrl = () => process.env.TRITON_RPC_URL || '';
const getDevnetRpcUrl = () => process.env.TRITON_RPC_URL_DEVNET || '';

/**
 * Detects whether `url` already carries an auth token (query string, or a
 * path segment after an `.rpcpool.com` host) so `appendToken` doesn't
 * double-append `TRITON_API_TOKEN`.
 * @param {string} url
 * @returns {boolean}
 */
const hasEmbeddedToken = (url) => {
  if (!url) return false;
  if (url.includes('?')) return true;
  if (!RPCPOOL_HOST_RE.test(url)) return false;
  // After the .rpcpool.com host, any further path segment is the token.
  const afterHost = url.split('.rpcpool.com')[1] || '';
  return afterHost.length > 1 && afterHost !== '/';
};

/**
 * Append `TRITON_API_TOKEN` as a trailing path segment (Triton's auth
 * convention) when `url` is a bare base URL and a token is configured.
 * No-op when the URL is empty, no token is set, or the URL already embeds
 * one (see `hasEmbeddedToken`).
 * @param {string} url - bare or already-tokened base URL.
 * @returns {string} URL with the token appended, or unchanged.
 */
const appendToken = (url) => {
  if (!url) return url;
  const token = getApiToken();
  if (!token) return url;
  if (hasEmbeddedToken(url)) return url;

  // Triton convention: token is a path segment after the host.
  // Strip trailing slash so we don't end up with `//token`.
  const base = url.replace(/\/+$/, '');
  return `${base}/${token}`;
};

/**
 * Returns the JSON-RPC URL with the token appended.
 *
 * - mainnet → TRITON_RPC_URL (required, throws TRITON_NOT_CONFIGURED if unset)
 * - devnet  → TRITON_RPC_URL_DEVNET if set, else public Solana devnet
 * - testnet → public Solana testnet (Triton does not host testnet)
 *
 * The resolver catches TRITON_NOT_CONFIGURED and routes the call to the
 * fallback provider.
 *
 * @param {string} [environment='mainnet'] - mainnet | devnet | testnet
 * @returns {string} Full RPC URL, token-appended per `appendToken`.
 * @throws {Error} with `err.code === 'TRITON_NOT_CONFIGURED'` when
 *   `environment` is mainnet and `TRITON_RPC_URL` is unset.
 */
const getRpcUrl = (environment = 'mainnet') => {
  if (environment === 'testnet') {
    return PUBLIC_TESTNET;
  }

  if (environment === 'devnet') {
    const devUrl = getDevnetRpcUrl();
    return devUrl ? appendToken(devUrl) : PUBLIC_DEVNET;
  }

  const mainUrl = getMainnetRpcUrl();
  if (!mainUrl) {
    const err = new Error('TRITON_RPC_URL is not configured');
    err.code = 'TRITON_NOT_CONFIGURED';
    throw err;
  }

  return appendToken(mainUrl);
};

/**
 * Whether Triton is usable for `environment` without hitting
 * TRITON_NOT_CONFIGURED. Used by the provider resolver to decide whether to
 * route to Triton at all before attempting a call.
 * @param {string} [environment='mainnet'] - mainnet | devnet | testnet
 * @returns {boolean} false for testnet (never Triton-hosted); otherwise
 *   whether the relevant RPC URL env var is set.
 */
const isConfigured = (environment = 'mainnet') => {
  if (environment === 'devnet') return Boolean(getDevnetRpcUrl());
  if (environment === 'testnet') return false;
  return Boolean(getMainnetRpcUrl());
};

module.exports = {
  getRpcUrl,
  isConfigured,
  getApiToken,
};
