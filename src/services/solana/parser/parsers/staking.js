'use strict';

/**
 * Liquid-staking + stake-pool parser.
 *
 * Covers:
 *   - Marinade Finance (mSOL native deposit/unstake)
 *   - SPL Stake Pool (used by JitoSOL and many others)
 *   - Sanctum LST router (aggregator across LSTs)
 *
 * The actual SOL ↔ LST token movements happen as CPIs to System / SPL Token,
 * which the system + spl-token parsers already capture. This parser only
 * tags the type hint so the orchestrator routes the tx into the STAKE
 * bucket of the 9-bucket FE scheme.
 *
 * Distinguishing deposit (stake) from withdraw (unstake) cleanly would
 * require decoding each program's instruction set; for now we set a single
 * `hasLiquidStake` hint that maps to STAKE_TOKEN. Direction is implicit in
 * inputs/outputs.
 */

const { SOURCES } = require('../program-sources');
const { createHintParser } = require('./_hint-parser');

module.exports = createHintParser({
  programIds: [
    ...SOURCES.MARINADE_FINANCE,
    ...SOURCES.STAKE_POOL,
    ...SOURCES.SANCTUM,
    ...SOURCES.SANCTUM_INFINITY,
  ],
  hint: 'hasLiquidStake',
});
