'use strict';

/**
 * Direct-DEX parser — flags any DEX program (aggregated or direct) so the
 * tx is bucketed as SWAP. When Jupiter routes through a DEX as a CPI both
 * `hasJupiter` and `hasDexSwap` end up set; both produce SWAP, so the
 * double-flag is harmless.
 *
 * Edge case (deliberate trade-off): liquidity operations on AMMs
 * (add_liquidity / remove_liquidity) get flagged as SWAP here even though
 * Helius classifies them as INTERACTION. This affects a small fraction of
 * wallet activity and can be refined per-program later by decoding
 * instruction discriminators.
 */

const { SOURCES } = require('../program-sources');
const { createHintParser } = require('./_hint-parser');

module.exports = createHintParser({
  programIds: [
    ...SOURCES.PHOENIX,
    ...SOURCES.OPENBOOK_V2,
    ...SOURCES.LIFINITY,
    ...SOURCES.SABER,
    ...SOURCES.RAYDIUM,
    ...SOURCES.ORCA,
    ...SOURCES.METEORA,
    ...SOURCES.PUMP_AMM,
    ...SOURCES.PHOTON,
    ...SOURCES.MOONSHOT,
    ...SOURCES.METEORA_DBC,
    ...SOURCES.MAYAN_FINANCE,
    ...SOURCES.LAUNCHLAB,
  ],
  hint: 'hasDexSwap',
});
