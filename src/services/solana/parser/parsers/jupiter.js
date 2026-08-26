'use strict';

/**
 * Jupiter aggregator parser.
 *
 * Jupiter (all router versions) executes a swap by composing CPIs to the
 * underlying AMMs (Raydium, Orca, Meteora, etc.). The actual SOL/token
 * movements happen in inner instructions, which the spl-token + system
 * parsers already capture. This parser only sets the `hasJupiter` hint so
 * the orchestrator's deriveType emits `SWAP` and `pickPrimarySource` tags
 * the source as JUPITER over inner DEX programs.
 *
 * `swapRoute` is populated downstream by
 * `helius-transaction-resource.buildSwapRoute`, which has the user address
 * and can pivot inputs/outputs by direction. `innerSwaps` and `swapFees`
 * are out of scope until per-DEX inner-instruction decoding lands.
 *
 * ProgramId detection is stable across router versions; instruction
 * discriminators are not, so we don't rely on them.
 */

const { SOURCES } = require('../program-sources');

// Aggregator router + Limit Orders v2 — both must produce the SWAP type and
// JUPITER source.
const JUPITER_PROGRAM_IDS = [...SOURCES.JUPITER, ...SOURCES.JUPITER_LIMIT];

/**
 * Match any Jupiter aggregator (router or Limit Orders v2) instruction and
 * set `hasJupiter`. The actual token/SOL movements are captured by the
 * spl-token + system parsers running on the same instruction's inner CPIs.
 * @param {object} _parsedIx - Parsed RPC instruction for a Jupiter program (unused)
 * @param {object} ctx       - Orchestrator context (`{ building, ... }`)
 * @returns {void}
 */
const parse = (_parsedIx, ctx) => {
  ctx.building._hints.hasJupiter = true;
};

module.exports = {
  programIds: JUPITER_PROGRAM_IDS,
  parse,
};
