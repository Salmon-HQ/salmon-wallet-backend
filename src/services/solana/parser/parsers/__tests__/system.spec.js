'use strict';

const system = require('../system');

const mockCtx = () => ({ building: { nativeTransfers: [] } });

describe('system parser', () => {
  test('programIds is the canonical System program', () => {
    expect(system.programIds).toEqual(['11111111111111111111111111111111']);
  });

  test('records transfer with numeric lamports', () => {
    const ctx = mockCtx();
    system.parse(
      {
        parsed: {
          type: 'transfer',
          info: { source: 'A', destination: 'B', lamports: 5_000_000 },
        },
      },
      ctx
    );
    expect(ctx.building.nativeTransfers).toEqual([
      { fromUserAccount: 'A', toUserAccount: 'B', amount: 5_000_000 },
    ]);
  });

  test('records transferWithSeed and from/to alias keys', () => {
    const ctx = mockCtx();
    system.parse(
      {
        parsed: {
          type: 'transferWithSeed',
          info: { from: 'A', to: 'B', lamports: 1 },
        },
      },
      ctx
    );
    expect(ctx.building.nativeTransfers[0]).toMatchObject({
      fromUserAccount: 'A',
      toUserAccount: 'B',
    });
  });

  test('coerces string lamports to number', () => {
    const ctx = mockCtx();
    system.parse(
      {
        parsed: {
          type: 'transfer',
          info: { source: 'A', destination: 'B', lamports: '1000' },
        },
      },
      ctx
    );
    expect(ctx.building.nativeTransfers[0].amount).toBe(1000);
  });

  test('skips when lamports missing or undefined', () => {
    const ctx = mockCtx();
    system.parse({ parsed: { type: 'transfer', info: { source: 'A', destination: 'B' } } }, ctx);
    expect(ctx.building.nativeTransfers).toHaveLength(0);
  });

  test('ignores non-transfer types (createAccount, allocate, etc.)', () => {
    const ctx = mockCtx();
    system.parse({ parsed: { type: 'createAccount', info: {} } }, ctx);
    system.parse({ parsed: { type: 'allocate', info: {} } }, ctx);
    expect(ctx.building.nativeTransfers).toHaveLength(0);
  });

  test('tolerates null parsedIx', () => {
    const ctx = mockCtx();
    system.parse(null, ctx);
    system.parse({ parsed: null }, ctx);
    expect(ctx.building.nativeTransfers).toHaveLength(0);
  });
});
