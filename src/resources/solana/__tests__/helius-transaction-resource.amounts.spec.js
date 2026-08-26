'use strict';

/**
 * Unit tests for the small numeric helpers in helius-transaction-resource:
 *   - `toRawAmount` (type-based dispatch between Helius numeric / Triton string)
 *   - `computeConversionRate` (BigInt-safe rate computation)
 */

const { __testing } = require('../helius-transaction-resource');
const { toRawAmount, computeConversionRate } = __testing;

describe('toRawAmount', () => {
  it('returns "0" for null / undefined', () => {
    expect(toRawAmount(null, 6)).toBe('0');
    expect(toRawAmount(undefined, 6)).toBe('0');
  });

  it('passes string inputs (Triton parser raw) through unchanged', () => {
    expect(toRawAmount('14832', 6)).toBe('14832');
    expect(toRawAmount('1', 6)).toBe('1');
    expect(toRawAmount('1000000000000000000000000000', 18)).toBe('1000000000000000000000000000');
  });

  it('multiplies number inputs (Helius formatted) by 10^decimals', () => {
    expect(toRawAmount(0.014832, 6)).toBe('14832');
    expect(toRawAmount(1.5, 9)).toBe('1500000000');
    expect(toRawAmount(31658.98336, 6)).toBe('31658983360');
  });

  it('handles decimals=0 numeric input', () => {
    expect(toRawAmount(5, 0)).toBe('5');
  });

  it('returns "0" for non-numeric input', () => {
    expect(toRawAmount(NaN, 6)).toBe('0');
  });

  it('numeric 1 with decimals > 0 multiplies (Helius "1.0 of token" convention)', () => {
    expect(toRawAmount(1, 6)).toBe('1000000');
  });

  it('still treats string "1" as raw — Triton path always emits raw atomic units', () => {
    expect(toRawAmount('1', 6)).toBe('1');
  });
});

describe('computeConversionRate', () => {
  it('produces 6-digit fixed precision string', () => {
    // 1 SOL -> 120 USDC: rate = 120.000000
    expect(computeConversionRate('1000000000', 9, '120000000', 6)).toBe('120.000000');
  });

  it('returns undefined for sentRaw=0', () => {
    expect(computeConversionRate('0', 9, '120000000', 6)).toBeUndefined();
  });

  it('returns undefined for invalid (non-numeric) inputs', () => {
    expect(computeConversionRate('abc', 9, '120', 6)).toBeUndefined();
    expect(computeConversionRate(undefined, 9, '120', 6)).toBeUndefined();
  });

  it('survives BigInt-scale amounts (BONK, decimals=18)', () => {
    expect(computeConversionRate('1000000000000000000000000000', 18, '20000000000', 6)).toBe(
      '0.000020'
    );
  });

  it('rate is invariant to absolute magnitude when ratio is constant', () => {
    const small = computeConversionRate('1000000000', 9, '120000000', 6);
    const big = computeConversionRate('1000000000000000', 9, '120000000000000', 6);
    expect(small).toBe(big);
  });
});

describe('normalizeInstructions', () => {
  const { normalizeInstructions } = __testing;

  it('returns undefined for non-array input', () => {
    expect(normalizeInstructions(undefined)).toBeUndefined();
    expect(normalizeInstructions(null)).toBeUndefined();
    expect(normalizeInstructions({})).toBeUndefined();
  });

  it('passes through Triton parser shape unchanged', () => {
    const triton = [
      { programId: 'A', innerInstructionsCount: 3 },
      { programId: 'B', innerInstructionsCount: 0 },
    ];
    expect(normalizeInstructions(triton)).toEqual(triton);
  });

  it('collapses Helius shape to {programId, innerInstructionsCount}', () => {
    const helius = [
      {
        programId: 'JUP6',
        accounts: ['acc1', 'acc2'],
        data: '0xdeadbeef',
        innerInstructions: [{}, {}, {}],
      },
      {
        programId: 'TOKEN',
        accounts: ['acc3'],
        data: '',
        innerInstructions: [],
      },
    ];
    expect(normalizeInstructions(helius)).toEqual([
      { programId: 'JUP6', innerInstructionsCount: 3 },
      { programId: 'TOKEN', innerInstructionsCount: 0 },
    ]);
  });

  it('treats missing innerInstructions as 0', () => {
    expect(normalizeInstructions([{ programId: 'X', accounts: [], data: '' }])).toEqual([
      { programId: 'X', innerInstructionsCount: 0 },
    ]);
  });
});
