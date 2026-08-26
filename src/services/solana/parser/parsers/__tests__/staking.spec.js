'use strict';

const staking = require('../staking');
const { SOURCES } = require('../../program-sources');

const mockCtx = () => ({ building: { _hints: {} } });

describe('staking parser (LST)', () => {
  test('programIds covers Marinade, Stake Pool, Sanctum', () => {
    expect(staking.programIds).toEqual(
      expect.arrayContaining([
        ...SOURCES.MARINADE_FINANCE,
        ...SOURCES.STAKE_POOL,
        ...SOURCES.SANCTUM,
      ])
    );
  });

  test('parse sets hasLiquidStake regardless of instruction shape', () => {
    const ctx = mockCtx();
    staking.parse({ parsed: { type: 'deposit' } }, ctx);
    expect(ctx.building._hints.hasLiquidStake).toBe(true);
  });

  test('parse tolerates null', () => {
    const ctx = mockCtx();
    staking.parse(null, ctx);
    expect(ctx.building._hints.hasLiquidStake).toBe(true);
  });
});
