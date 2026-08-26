'use strict';

/**
 * Layer-agnostic Solana program IDs.
 *
 * Both the resource layer (transaction shaping) and the service-layer parser
 * (program-sources lookup) need to know about a small set of programs:
 * Jupiter aggregator versions, Bubblegum (cNFT), Token-2022, etc. Keeping
 * these in `src/constants` lets both layers import without violating the
 * AGENTS placement rule (resources don't reach into services).
 *
 * Add new program IDs to the canonical list here; `parser/program-sources.js`
 * re-exports them under its `SOURCES` table so the parser keeps its single
 * source of truth for source-name resolution.
 */

// Jupiter aggregator routers — every version Salmon has historically seen.
// Latest first. Helius source: 'JUPITER'.
const JUPITER_PROGRAM_IDS = [
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // v6 (current)
  'JUP5cHjnnCx2DppVsufsLrXs8EBZeEZzGtEK9Gdz6ow',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
  'JUP3c2Uh3WA4Ng34oL4N1jYG7R7xSJJRpf8Gp6p6C',
  'JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo',
];

// Jupiter Limit Orders v2 — distinct surface from the aggregator router but
// callers (resource Jupiter detection, parser Jupiter classifier) need it
// tagged as Jupiter for SWAP bucketing.
const JUPITER_LIMIT_PROGRAM_IDS = ['j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X'];

// Metaplex Bubblegum — compressed NFT program.
const BUBBLEGUM_PROGRAM_ID = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';

module.exports = {
  JUPITER_PROGRAM_IDS,
  JUPITER_LIMIT_PROGRAM_IDS,
  BUBBLEGUM_PROGRAM_ID,
};
