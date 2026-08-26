'use strict';

const jupiter = require('../jupiter');
const { SOURCES } = require('../../program-sources');

const mockCtx = () => ({ building: { _hints: {} } });

describe('jupiter parser', () => {
  test('programIds covers both aggregator router and Limit Orders v2', () => {
    expect(jupiter.programIds).toEqual([...SOURCES.JUPITER, ...SOURCES.JUPITER_LIMIT]);
    expect(jupiter.programIds.length).toBeGreaterThan(SOURCES.JUPITER.length);
  });

  test('a JUPITER_LIMIT programId triggers hasJupiter (was TRANSFER bug pre-fix)', () => {
    // Sanity: any limit-order program id matches the parser registry.
    expect(jupiter.programIds).toEqual(expect.arrayContaining(SOURCES.JUPITER_LIMIT));
  });

  test('parse sets hasJupiter hint regardless of instruction shape', () => {
    const ctx = mockCtx();
    jupiter.parse({ parsed: { type: 'doesnt-matter' } }, ctx);
    expect(ctx.building._hints.hasJupiter).toBe(true);
  });

  test('parse tolerates undefined parsedIx', () => {
    const ctx = mockCtx();
    jupiter.parse(undefined, ctx);
    expect(ctx.building._hints.hasJupiter).toBe(true);
  });
});
