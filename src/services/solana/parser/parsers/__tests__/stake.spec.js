'use strict';

const stake = require('../stake');

const mockCtx = () => ({ building: { _hints: {} } });

describe('stake parser', () => {
  test('programIds contains the canonical Stake program', () => {
    expect(stake.programIds).toEqual(['Stake11111111111111111111111111111111111111']);
  });

  test('STAKE_TYPES set hasStake', () => {
    for (const type of [
      'delegate',
      'redelegate',
      'authorize',
      'initialize',
      'split',
      'merge',
      'setLockup',
    ]) {
      const ctx = mockCtx();
      stake.parse({ parsed: { type } }, ctx);
      expect(ctx.building._hints.hasStake).toBe(true);
      expect(ctx.building._hints.hasUnstake).toBeUndefined();
    }
  });

  test('UNSTAKE_TYPES set hasUnstake', () => {
    for (const type of ['deactivate', 'withdraw']) {
      const ctx = mockCtx();
      stake.parse({ parsed: { type } }, ctx);
      expect(ctx.building._hints.hasUnstake).toBe(true);
      expect(ctx.building._hints.hasStake).toBeUndefined();
    }
  });

  test('missing parsed.type defaults to hasStake (current behavior)', () => {
    const ctx = mockCtx();
    stake.parse({ parsed: {} }, ctx);
    expect(ctx.building._hints.hasStake).toBe(true);
  });

  test('null parsedIx tolerated', () => {
    const ctx = mockCtx();
    stake.parse(null, ctx);
    expect(ctx.building._hints.hasStake).toBe(true);
  });

  test('unrecognized type leaves no stake hint', () => {
    const ctx = mockCtx();
    stake.parse({ parsed: { type: 'someUnknownOp' } }, ctx);
    expect(ctx.building._hints.hasStake).toBeUndefined();
    expect(ctx.building._hints.hasUnstake).toBeUndefined();
  });
});
