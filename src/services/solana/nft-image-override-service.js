'use strict';

/**
 * Solana NFT image override lookup.
 *
 * Some Solana NFTs ship metadata with broken or rate-limited image URLs.
 * The repo seeds a curated mint → working-Arweave-URL map. The decorator
 * (`solana-nft-resource`) reads it before falling back to the
 * provider-supplied `image` field, so every client sees the corrected URL
 * without shipping the table itself.
 *
 * Source: `data/nft-image-overrides.json`. Entries are keyed by mint
 * (base58, case-sensitive). The seed (~1.1 MB) is lazy-loaded on first
 * lookup so non-NFT request paths do not pay the deserialization cost on
 * a serverless cold start.
 */

let cachedOverrides = null;

const loadOverrides = () => {
  if (cachedOverrides === null) {
    cachedOverrides = require('./data/nft-image-overrides.json');
  }
  return cachedOverrides;
};

/**
 * @param {string} mint
 * @returns {string|null} Override URL, or null if there is no override.
 */
const lookup = (mint) => {
  if (!mint || typeof mint !== 'string') {
    return null;
  }
  return loadOverrides()[mint] || null;
};

/** Test-only: drop the cached map so tests can assert lazy reload semantics. */
const __resetForTests = () => {
  cachedOverrides = null;
};

module.exports = { lookup, __resetForTests };
