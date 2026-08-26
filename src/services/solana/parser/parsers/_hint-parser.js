'use strict';

/**
 * Factory for parsers whose only job is to set a single hint flag on the
 * orchestrator's `building._hints` map. The DEX, lending, and liquid-staking
 * parsers all share this shape — distinguishing per-instruction behavior
 * would require decoding each program's IDL.
 *
 * Usage:
 *
 *   module.exports = createHintParser({
 *     programIds: [...SOURCES.RAYDIUM, ...SOURCES.ORCA],
 *     hint: 'hasDexSwap',
 *   });
 *
 * The orchestrator's `deriveType` reads the hint and emits the right tx
 * type bucket; the underlying token transfers populate inputs/outputs via
 * the spl-token + system parsers running in the same dispatch pass.
 */

/**
 * Build a parser module that only sets a hint flag — no transfer extraction.
 * @param {object} config
 * @param {string[]} config.programIds - Program IDs this parser registers for
 * @param {string} config.hint - Key set to `true` on `ctx.building._hints` on match
 * @returns {{programIds: string[], parse: function(object, object): void}}
 *   Parser module shape consumed by the orchestrator's PARSER_REGISTRY
 */
const createHintParser = ({ programIds, hint }) => ({
  programIds,
  parse: (_parsedIx, ctx) => {
    ctx.building._hints[hint] = true;
  },
});

module.exports = { createHintParser };
