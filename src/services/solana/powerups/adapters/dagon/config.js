'use strict';

/**
 * Dagon's `devnet.json`: the per-epoch addresses (mints, vaults, pool,
 * executor URL) read at runtime, so a new Dagon epoch needs no deploy.
 *
 * The copy is trusted only when it names the programs pinned here (the
 * registry reuses these ids) and the one executor host we know; anything
 * else is refused and the last good copy keeps serving. Byte layouts are
 * program layout, pinned with the program ids in `instructions.js`, so the
 * remote `layout` block is dropped, and so is `rpcEndpoint`: devnet reads
 * use the network's own RPC.
 */

const axios = require('axios');
const { providerCall } = require('../../../../../infrastructure/providers/provider-client');
const { toSafeError } = require('../../../../../infrastructure/log-redaction');
const { isValidSolanaAddress } = require('../../../../../utils/solana-address');
const { PowerupError } = require('../../powerup-errors');

const PC_TOKEN_PROGRAM_ID = '3kjJEx6G1XdrtixFg9f8eGRAyzW5QmhsJQq6qCUZYhXZ';
const PC_SWAP_PROGRAM_ID = 'BqJMtWQYiis1264KqBN3wssNqTofK5RuP67hkZYvb4SD';
const ENCRYPT_PROGRAM_ID = '4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8';

const CONFIG_URL =
  'https://raw.githubusercontent.com/inkwell-finance/pc-wallet-kit/main/devnet.json';
const EXECUTOR_HOST = 'pre-alpha-dev-1.encrypt.ika-network.net';
const CACHE_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

const SIDE_ADDRESSES = ['splMint', 'pcMint', 'vault', 'vaultAta'];
const POOL_ADDRESSES = [
  'address',
  'vaultAccountA',
  'vaultAccountB',
  'vaultBalanceCtA',
  'vaultBalanceCtB',
  'reserveCtA',
  'reserveCtB',
];

let cached = null;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isExecutorUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === EXECUTOR_HOST;
  } catch {
    return false;
  }
};

const isSide = (side) =>
  isObject(side) &&
  SIDE_ADDRESSES.every((key) => isValidSolanaAddress(side[key])) &&
  Number.isInteger(side.decimals);

/** Why `doc` cannot be trusted, or null when it can. */
const refusalOf = (doc) => {
  if (!isObject(doc)) return 'not_an_object';
  if (doc.cluster !== 'devnet') return 'cluster';
  const programs = doc.programs || {};
  if (
    programs.pcToken !== PC_TOKEN_PROGRAM_ID ||
    programs.pcSwap !== PC_SWAP_PROGRAM_ID ||
    programs.encrypt !== ENCRYPT_PROGRAM_ID
  ) {
    return 'programs';
  }
  if (!isExecutorUrl(doc.encryptGrpcUrl)) return 'executor_url';
  if (!/^[0-9a-f]{64}$/i.test(doc.networkKeyHex || '')) return 'network_key';
  if (!Number.isInteger(doc.fheTypeU64)) return 'fhe_type';
  const sides = doc.sides;
  if (!isObject(sides) || Object.keys(sides).length === 0 || !Object.values(sides).every(isSide)) {
    return 'sides';
  }
  const pool = doc.pool;
  if (
    !isObject(pool) ||
    !POOL_ADDRESSES.every((key) => isValidSolanaAddress(pool[key])) ||
    !Object.hasOwn(sides, pool.sideA) ||
    !Object.hasOwn(sides, pool.sideB) ||
    pool.sideA === pool.sideB
  ) {
    return 'pool';
  }
  return null;
};

const fetchDoc = async (locals) => {
  const { data } = await providerCall(
    'dagon-config',
    ({ timeout, signal }) =>
      axios.get(CONFIG_URL, { timeout, signal, maxContentLength: MAX_BODY_BYTES }),
    { locals }
  );
  return typeof data === 'string' ? JSON.parse(data) : data;
};

/**
 * The accepted `devnet.json`, from the 5-minute cache or a fresh fetch.
 * @param {Object} locals - request locals (budget, breaker scope)
 * @returns {Promise<Object>}
 * @throws {PowerupError} 503 `dagon_config_unavailable` when no copy was ever accepted
 */
const getConfig = async (locals) => {
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.config;
  }
  let reason;
  try {
    const doc = await fetchDoc(locals);
    reason = refusalOf(doc);
    if (!reason) {
      const config = { ...doc };
      delete config.layout;
      delete config.rpcEndpoint;
      cached = { config, fetchedAt: Date.now() };
      return config;
    }
    console.error('[DAGON_CONFIG] devnet.json refused', { reason, epoch: doc?.epoch });
  } catch (error) {
    reason = 'fetch_failed';
    console.error('[DAGON_CONFIG] devnet.json unavailable', { reason, error: toSafeError(error) });
  }
  if (cached) {
    return cached.config;
  }
  throw new PowerupError(
    'Dagon configuration is unavailable, please retry later',
    503,
    'dagon_config_unavailable'
  );
};

module.exports = {
  getConfig,
  PC_TOKEN_PROGRAM_ID,
  PC_SWAP_PROGRAM_ID,
  ENCRYPT_PROGRAM_ID,
};
