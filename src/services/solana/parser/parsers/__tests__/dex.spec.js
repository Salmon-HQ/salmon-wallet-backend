'use strict';

const dex = require('../dex');
const { SOURCES } = require('../../program-sources');

const mockCtx = () => ({ building: { _hints: {} } });

describe('dex parser', () => {
  test('programIds covers all direct-DEX programs', () => {
    expect(dex.programIds).toEqual(
      expect.arrayContaining([
        ...SOURCES.PHOENIX,
        ...SOURCES.OPENBOOK_V2,
        ...SOURCES.LIFINITY,
        ...SOURCES.SABER,
        ...SOURCES.RAYDIUM,
        ...SOURCES.ORCA,
        ...SOURCES.METEORA,
      ])
    );
  });

  test('parse sets hasDexSwap regardless of instruction shape', () => {
    const ctx = mockCtx();
    dex.parse({ parsed: { type: 'swap' } }, ctx);
    expect(ctx.building._hints.hasDexSwap).toBe(true);
  });

  test('parse tolerates undefined / null', () => {
    const ctx = mockCtx();
    dex.parse(undefined, ctx);
    expect(ctx.building._hints.hasDexSwap).toBe(true);
  });
});
