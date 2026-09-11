'use strict';

/**
 * Per-mint token metadata from the Digital Asset Standard API on the Triton
 * RPC endpoint (`getAssetBatch` with `showFungible`).
 *
 * Answers the canonical token shape used everywhere downstream
 * (`id`, `symbol`, `name`, `decimals`, `icon`, `tokenProgram`, `swappable`)
 * for ANY mint, listed or not. Verified tags and `coingeckoId` are the
 * catalog's business (`token-catalog-service`), merged by `solana-ft-service`.
 *
 * `swappable` encodes the routing provider's documented Token-2022 rule:
 * not routable when the transfer fee is > 0, a transfer hook program is set,
 * or the mint is non-transferable. Probed 2026-09-11: PYUSD (hook program
 * null, fee 0) is routable; BERN (269 bps fee) is not.
 */

const axios = require('axios');
const { getRpcUrl } = require('../../infrastructure/triton-client');
const {
  getCacheKeyFor,
  getFromCache,
  storeInCache,
} = require('../../infrastructure/cache/cache-helper');
const {
  SOL_ADDRESS,
  SOL_SYMBOL,
  SOL_NAME,
  SOL_DECIMALS,
  SOL_LOGO,
} = require('../../constants/solana-constants');

/** DAS accepts at most this many ids per getAssetBatch. */
const MAX_IDS_PER_BATCH = 1000;
const CACHE_TTL_SECONDS = 60 * 60;
const REQUEST_TIMEOUT = 10000;
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const NATIVE_SOL = {
  id: SOL_ADDRESS,
  symbol: SOL_SYMBOL,
  name: SOL_NAME,
  decimals: SOL_DECIMALS,
  icon: SOL_LOGO,
  tokenProgram: 'spl-token',
  swappable: true,
};

/** 0x's Token-2022 routing rule, from the DAS `mint_extensions` block. */
const isSwappable = (extensions) => {
  if (!extensions) {
    return true;
  }
  const feeConfig = extensions.transfer_fee_config;
  const fee = feeConfig?.newer_transfer_fee ?? feeConfig?.older_transfer_fee ?? null;
  if (fee && Number(fee.transfer_fee_basis_points) > 0) {
    return false;
  }
  if (extensions.transfer_hook?.program_id) {
    return false;
  }
  return !extensions.non_transferable;
};

/** DAS asset → canonical token; null when the asset is not a fungible mint we can describe. */
const toToken = (asset) => {
  if (!asset || !asset.id) {
    return null;
  }
  const metadata = asset.content?.metadata || {};
  const tokenInfo = asset.token_info || {};
  if (typeof tokenInfo.decimals !== 'number') {
    return null;
  }
  return {
    id: asset.id,
    symbol: metadata.symbol || tokenInfo.symbol || null,
    name: metadata.name || null,
    decimals: tokenInfo.decimals,
    icon: asset.content?.links?.image || null,
    tokenProgram: tokenInfo.token_program === TOKEN_2022_PROGRAM ? 'token-2022' : 'spl-token',
    swappable: isSwappable(asset.mint_extensions),
  };
};

const fetchBatch = async (ids, environment) => {
  const { data } = await axios.post(
    getRpcUrl(environment),
    {
      jsonrpc: '2.0',
      id: 'token-metadata',
      method: 'getAssetBatch',
      params: { ids, displayOptions: { showFungible: true } },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT }
  );
  if (data?.error) {
    throw new Error(
      `DAS getAssetBatch failed: ${data.error.message || JSON.stringify(data.error)}`
    );
  }
  return Array.isArray(data?.result) ? data.result : [];
};

const cacheKey = (mint, locals) => getCacheKeyFor('token_metadata', 'mint', mint, locals);

/**
 * Resolve metadata for a set of mints. Unknown or non-fungible mints are
 * simply absent from the result. Native SOL never hits the network.
 *
 * @param {string[]} mints
 * @param {Object} [locals] - reads `network.environment`.
 * @returns {Promise<Map<string, Object>>} mint → canonical token.
 */
const getByMints = async (mints, locals = {}) => {
  const result = new Map();
  const wanted = [...new Set(mints)].filter(Boolean);
  const misses = [];

  for (const mint of wanted) {
    if (mint === SOL_ADDRESS) {
      result.set(mint, NATIVE_SOL);
      continue;
    }
    const cached = await getFromCache(cacheKey(mint, locals));
    if (cached) {
      result.set(mint, cached);
    } else {
      misses.push(mint);
    }
  }

  const environment = locals?.network?.environment || 'mainnet';
  for (let i = 0; i < misses.length; i += MAX_IDS_PER_BATCH) {
    const assets = await fetchBatch(misses.slice(i, i + MAX_IDS_PER_BATCH), environment);
    for (const asset of assets) {
      const token = toToken(asset);
      if (token) {
        result.set(token.id, token);
        await storeInCache(cacheKey(token.id, locals), token, CACHE_TTL_SECONDS);
      }
    }
  }

  return result;
};

module.exports = { getByMints, isSwappable, toToken, NATIVE_SOL, MAX_IDS_PER_BATCH };
