'use strict';

const aggregator = require('../aggregator');
const { SOURCES } = require('../../program-sources');

const mockCtx = () => ({ building: { _hints: {} } });

describe('aggregator parser', () => {
  test('programIds covers both aggregator router and Limit Orders v2', () => {
    expect(aggregator.programIds).toEqual([...SOURCES.AGGREGATOR, ...SOURCES.AGGREGATOR_LIMIT]);
    expect(aggregator.programIds.length).toBeGreaterThan(SOURCES.AGGREGATOR.length);
  });

  test('a AGGREGATOR_LIMIT programId triggers hasAggregator (was TRANSFER bug pre-fix)', () => {
    // Sanity: any limit-order program id matches the parser registry.
    expect(aggregator.programIds).toEqual(expect.arrayContaining(SOURCES.AGGREGATOR_LIMIT));
  });

  test('parse sets hasAggregator hint regardless of instruction shape', () => {
    const ctx = mockCtx();
    aggregator.parse({ parsed: { type: 'doesnt-matter' } }, ctx);
    expect(ctx.building._hints.hasAggregator).toBe(true);
  });

  test('parse tolerates undefined parsedIx', () => {
    const ctx = mockCtx();
    aggregator.parse(undefined, ctx);
    expect(ctx.building._hints.hasAggregator).toBe(true);
  });
});
