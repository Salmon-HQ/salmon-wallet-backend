'use strict';

const {
  SOURCES,
  PROGRAM_TO_SOURCE,
  SOURCE_PRIORITY,
  PRIORITY_BANDS,
  getSource,
  pickPrimarySource,
  isJupiter,
  isMetaplex,
  isBubblegum,
  isStakeProgram,
  isToken,
} = require('../program-sources');

describe('program-sources — coverage and consistency', () => {
  test('every SOURCES entry has a SOURCE_PRIORITY band', () => {
    for (const sourceName of Object.keys(SOURCES)) {
      expect(SOURCE_PRIORITY).toHaveProperty(sourceName);
    }
  });

  test('every SOURCE_PRIORITY entry refers to a known SOURCES name', () => {
    for (const sourceName of Object.keys(SOURCE_PRIORITY)) {
      expect(SOURCES).toHaveProperty(sourceName);
    }
  });

  test('SOURCE_PRIORITY values are all defined PRIORITY_BANDS values', () => {
    const validBands = new Set(Object.values(PRIORITY_BANDS));
    for (const [name, value] of Object.entries(SOURCE_PRIORITY)) {
      expect({ name, validBand: validBands.has(value) }).toEqual({ name, validBand: true });
    }
  });

  test('PROGRAM_TO_SOURCE lookup matches direct SOURCES traversal', () => {
    for (const [sourceName, ids] of Object.entries(SOURCES)) {
      for (const id of ids) {
        expect(PROGRAM_TO_SOURCE.get(id)).toBe(sourceName);
      }
    }
  });
});

describe('getSource', () => {
  test('returns the source name for a known program id', () => {
    expect(getSource(SOURCES.JUPITER[0])).toBe('JUPITER');
    expect(getSource(SOURCES.RAYDIUM[0])).toBe('RAYDIUM');
  });

  test('returns null for an unknown program id', () => {
    expect(getSource('UnknownProgram1111111111111111111111')).toBeNull();
  });
});

describe('pickPrimarySource — priority matrix', () => {
  test('returns null for empty or undefined input', () => {
    expect(pickPrimarySource([])).toBeNull();
    expect(pickPrimarySource(undefined)).toBeNull();
  });

  test('JUPITER beats every AMM (aggregator > AMM)', () => {
    expect(pickPrimarySource(['RAYDIUM', 'JUPITER'])).toBe('JUPITER');
    expect(pickPrimarySource(['ORCA', 'METEORA', 'JUPITER'])).toBe('JUPITER');
  });

  test('JUPITER_LIMIT shares JUPITER priority — first-come wins among same band', () => {
    // Both at AGGREGATOR=0; the sorted-set order depends on input. Just assert
    // the winner is in the AGGREGATOR band, not a lower-tier source.
    const winner = pickPrimarySource(['RAYDIUM', 'JUPITER_LIMIT', 'TOKEN_PROGRAM']);
    expect(['JUPITER', 'JUPITER_LIMIT']).toContain(winner);
  });

  test('SANCTUM (aggregator) beats STAKE_POOL (LENDING_LST band)', () => {
    expect(pickPrimarySource(['STAKE_POOL', 'SANCTUM'])).toBe('SANCTUM');
  });

  test('MAGIC_EDEN beats RAYDIUM (LAUNCHPAD_NFT > AMM)', () => {
    expect(pickPrimarySource(['RAYDIUM', 'MAGIC_EDEN'])).toBe('MAGIC_EDEN');
  });

  test('RAYDIUM beats METAPLEX_TOKEN_METADATA (AMM > NFT_METADATA)', () => {
    expect(pickPrimarySource(['METAPLEX_TOKEN_METADATA', 'RAYDIUM'])).toBe('RAYDIUM');
  });

  test('METAPLEX_TOKEN_METADATA beats TOKEN_PROGRAM', () => {
    expect(pickPrimarySource(['TOKEN_PROGRAM', 'METAPLEX_TOKEN_METADATA'])).toBe(
      'METAPLEX_TOKEN_METADATA'
    );
  });

  test('TOKEN_PROGRAM beats SYSTEM_PROGRAM', () => {
    expect(pickPrimarySource(['SYSTEM_PROGRAM', 'TOKEN_PROGRAM'])).toBe('TOKEN_PROGRAM');
  });

  test('unknown source falls to lowest priority (sorts last)', () => {
    expect(pickPrimarySource(['JUPITER', 'TOTALLY_UNKNOWN'])).toBe('JUPITER');
    expect(pickPrimarySource(['TOTALLY_UNKNOWN', 'TOKEN_PROGRAM'])).toBe('TOKEN_PROGRAM');
  });

  test('deduplicates input', () => {
    expect(pickPrimarySource(['JUPITER', 'JUPITER', 'JUPITER'])).toBe('JUPITER');
  });
});

describe('predicate helpers', () => {
  test('isJupiter matches every aggregator program id', () => {
    SOURCES.JUPITER.forEach((id) => expect(isJupiter(id)).toBe(true));
    expect(isJupiter('not-jupiter')).toBe(false);
  });

  test('isMetaplex / isBubblegum / isStakeProgram', () => {
    expect(isMetaplex(SOURCES.METAPLEX_TOKEN_METADATA[0])).toBe(true);
    expect(isBubblegum(SOURCES.BUBBLEGUM[0])).toBe(true);
    expect(isStakeProgram(SOURCES.STAKE_PROGRAM[0])).toBe(true);
  });

  test('isToken matches both Token and Token-2022', () => {
    expect(isToken(SOURCES.TOKEN_PROGRAM[0])).toBe(true);
    expect(isToken(SOURCES.TOKEN_2022_PROGRAM[0])).toBe(true);
    expect(isToken('not-token')).toBe(false);
  });
});
