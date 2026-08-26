'use strict';

/**
 * Helius client — centralized config for the Helius RPC + Enhanced
 * Transactions API endpoints. Provides:
 *
 *  - RPC URL with API key appended as `?api-key=...`
 *  - Enhanced Transactions API endpoint builder
 *  - `isEnhancedApiSupported` gate (mainnet/devnet only)
 */

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// HELIUS_API_KEY is no longer required at module load — Triton-only deploys
// would import this module transitively (network config, fallback wiring) and
// would crash before reaching `if (tritonClient.isConfigured)`. Each function
// throws if the key is genuinely missing AND the function is invoked.
/**
 * Guard clause: throws when `HELIUS_API_KEY` is unset. Called lazily by
 * functions that actually need the key, so modules that merely import this
 * client (without invoking a keyed function) don't crash on missing config.
 * @throws {Error} `HELIUS_API_KEY environment variable is required for this Helius call`
 */
const requireKey = () => {
  if (!HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY environment variable is required for this Helius call');
  }
};

/**
 * Build the Helius RPC URL for the given environment, appending the API key
 * for mainnet/devnet. `testnet` returns the public Solana RPC and does not
 * require a key.
 * @param {string} [environment='mainnet'] - mainnet | devnet | testnet
 * @returns {string} Full RPC URL.
 * @throws {Error} `HELIUS_API_KEY environment variable is required for this Helius call`
 *   when `environment` is mainnet or devnet (or any non-testnet value falling
 *   back to mainnet) and `HELIUS_API_KEY` is unset.
 */
const getRpcUrl = (environment = 'mainnet') => {
  const baseUrls = {
    mainnet: 'https://mainnet.helius-rpc.com',
    devnet: 'https://devnet.helius-rpc.com',
    testnet: 'https://api.testnet.solana.com',
  };

  const baseUrl = baseUrls[environment] || baseUrls.mainnet;

  if (environment === 'testnet') {
    return baseUrl;
  }

  requireKey();
  return `${baseUrl}/?api-key=${HELIUS_API_KEY}`;
};

// Enhanced Transactions API endpoints — Helius does not support testnet.
const ENHANCED_API_URLS = {
  mainnet: 'https://api-mainnet.helius-rpc.com',
  devnet: 'https://api-devnet.helius-rpc.com',
};

/**
 * True if Helius Enhanced API supports this environment (mainnet, devnet).
 * @param {string} environment
 * @returns {boolean}
 */
const isEnhancedApiSupported = (environment) => {
  return Object.hasOwn(ENHANCED_API_URLS, environment);
};

/**
 * Base Enhanced Transactions API URL for `environment` (no API key appended).
 * @param {string} [environment='mainnet'] - mainnet | devnet (testnet unsupported)
 * @returns {string|null} Base URL, or null for unsupported environments
 *   (returned instead of silently falling back to mainnet).
 */
const getEnhancedTransactionsUrl = (environment = 'mainnet') => {
  // null for unsupported environments instead of silently falling back
  return ENHANCED_API_URLS[environment] || null;
};

// Default commitment level. Aligned with the Triton parser
// (`parser/triton-rpc.js`) and the transaction service so both providers
// honor the same confirmation window. Helius's own docs recommend
// `'finalized'` for the Enhanced API, but Salmon trades the extra latency
// for consistency with bare-RPC reads.
const DEFAULT_COMMITMENT = 'confirmed';

/**
 * Build a complete Enhanced Transactions API URL with the API key appended.
 * @param {string} environment - mainnet | devnet (testnet unsupported)
 * @param {string} path - Endpoint path, e.g. `/v0/transactions`
 * @returns {string|null} Full URL or null if environment is unsupported.
 * @throws {Error} `HELIUS_API_KEY environment variable is required for this Helius call`
 *   when the environment is supported (mainnet/devnet) and `HELIUS_API_KEY` is
 *   unset. Unsupported environments return null without throwing.
 */
const buildEnhancedApiUrl = (environment, path) => {
  const baseUrl = getEnhancedTransactionsUrl(environment);
  if (!baseUrl) {
    return null;
  }
  requireKey();
  const separator = path.includes('?') ? '&' : '?';
  return `${baseUrl}${path}${separator}api-key=${HELIUS_API_KEY}`;
};

module.exports = {
  HELIUS_API_KEY,
  getRpcUrl,
  getEnhancedTransactionsUrl,
  buildEnhancedApiUrl,
  isEnhancedApiSupported,
  DEFAULT_COMMITMENT,
};
