'use strict';

/**
 * Swap-aggregator parser.
 *
 * The aggregator router (all versions) executes a swap by composing CPIs to the
 * underlying AMMs (Raydium, Orca, Meteora, etc.). The actual SOL/token
 * movements happen in inner instructions, which the spl-token + system
 * parsers already capture. This parser only sets the `hasAggregator` hint so
 * the orchestrator's deriveType emits `SWAP` and `pickPrimarySource` tags
 * the source as AGGREGATOR over inner DEX programs.
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
// AGGREGATOR source.
const AGGREGATOR_ROUTER_PROGRAM_IDS = [...SOURCES.AGGREGATOR, ...SOURCES.AGGREGATOR_LIMIT];

/**
 * Match any aggregator (router or Limit Orders v2) instruction and
 * set `hasAggregator`. The actual token/SOL movements are captured by the
 * spl-token + system parsers running on the same instruction's inner CPIs.
 * @param {object} _parsedIx - Parsed RPC instruction for a aggregator program (unused)
 * @param {object} ctx       - Orchestrator context (`{ building, ... }`)
 * @returns {void}
 */
const parse = (_parsedIx, ctx) => {
  ctx.building._hints.hasAggregator = true;
};

module.exports = {
  programIds: AGGREGATOR_ROUTER_PROGRAM_IDS,
  parse,
};
