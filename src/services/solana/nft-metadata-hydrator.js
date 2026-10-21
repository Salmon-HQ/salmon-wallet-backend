'use strict';

/**
 * Restores the off-chain half of an NFT's metadata.
 *
 * Helius hydrated the `json_uri` document inside its own indexer, so DAS
 * responses arrived with `description`, `attributes` and `image` already
 * merged into `content.metadata`. Triton indexes on-chain data only and hands
 * back the bare `json_uri`. Everything downstream — the resource, and through
 * it the spam detector — was written against the Helius shape, so the cutover
 * silently emptied those fields. This module does that fetch ourselves, which
 * keeps the pipeline working on either provider.
 *
 * Fail-open is deliberate. A metadata document that cannot be fetched is not
 * evidence of anything: plenty of legitimate NFTs point at IPFS pins that no
 * longer resolve. When hydration does not land we mark the NFT unresolved and
 * let the spam detector skip the heuristics that need those fields, rather than
 * scoring the NFT as spam and hiding it from the person who owns it.
 */

const repository = require('../../repositories/solana/nft-metadata-repository');
const { normalizeIpfsUrl } = require('../../resources/solana/content-urls');

const CONCURRENCY = 8;

// Whole-listing budget. A wallet full of NFTs with dead pins would otherwise
// serialize into one timeout after another; at the deadline the fetches still
// in flight are aborted and the rest stay unresolved instead of holding the
// response open.
const TOTAL_BUDGET_MS = 8000;

/** True when the DAS payload already carries the off-chain fields (Helius). */
const hasOffchainFields = (json) =>
  Boolean(json) &&
  (json.description !== undefined || json.attributes !== undefined || json.image !== undefined);

/**
 * Hydrate one NFT.
 *
 * `metadataResolved` tells the spam detector whether the metadata it is about
 * to score is complete. It is never left undefined: `false` means "we could not
 * find out", which is the signal to fail open.
 */
const hydrateOne = async (nft, locals, signal) => {
  if (!nft) return nft;

  if (hasOffchainFields(nft.json)) {
    return { ...nft, metadataResolved: true };
  }

  const url = nft.uri ? normalizeIpfsUrl(nft.uri) : null;
  if (!url || signal.aborted) {
    return { ...nft, metadataResolved: false };
  }

  const offchain = await repository.getOffchainMetadata(url, locals, signal);
  if (!offchain) {
    return { ...nft, metadataResolved: false };
  }

  return {
    ...nft,
    // On-chain name/symbol/token_standard win: they are the authoritative copy.
    json: { ...offchain, ...(nft.json || {}) },
    metadataResolved: true,
  };
};

const mapWithConcurrency = async (items, limit, fn) => {
  const results = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** Runs `fn(signal)` with a signal that aborts after TOTAL_BUDGET_MS. */
const withBudget = async (fn) => {
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), TOTAL_BUDGET_MS);
  try {
    return await fn(budget.signal);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * @param {Array<Object>} nfts
 * @param {Object} locals
 * @returns {Promise<Array<Object>>} The same NFTs, with off-chain metadata merged in.
 */
const hydrateMany = async (nfts, locals) => {
  if (!Array.isArray(nfts) || nfts.length === 0) return nfts;

  return withBudget((signal) =>
    mapWithConcurrency(nfts, CONCURRENCY, (nft) => hydrateOne(nft, locals, signal))
  );
};

/**
 * @param {Object} nft
 * @param {Object} locals
 * @returns {Promise<Object>} The same NFT, with off-chain metadata merged in.
 */
const hydrate = async (nft, locals) => withBudget((signal) => hydrateOne(nft, locals, signal));

module.exports = {
  hydrate,
  hydrateMany,
  __testing: { hasOffchainFields, mapWithConcurrency, CONCURRENCY, TOTAL_BUDGET_MS },
};
