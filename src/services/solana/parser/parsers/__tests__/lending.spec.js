'use strict';

const lending = require('../lending');
const { SOURCES } = require('../../program-sources');

const mockCtx = () => ({ building: { _hints: {} } });

describe('lending parser', () => {
  test('programIds covers Solend, Kamino, MarginFi', () => {
    expect(lending.programIds).toEqual(
      expect.arrayContaining([...SOURCES.SOLEND, ...SOURCES.KAMINO, ...SOURCES.MARGINFI])
    );
  });

  test('parse sets hasLoan regardless of instruction shape', () => {
    const ctx = mockCtx();
    lending.parse({ parsed: { type: 'borrow' } }, ctx);
    expect(ctx.building._hints.hasLoan).toBe(true);
  });

  test('parse tolerates null parsedIx', () => {
    const ctx = mockCtx();
    lending.parse(null, ctx);
    expect(ctx.building._hints.hasLoan).toBe(true);
  });
});
