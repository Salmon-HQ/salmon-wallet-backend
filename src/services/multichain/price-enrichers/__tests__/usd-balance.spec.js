'use strict';

const { computeUsdBalance } = require('../usd-balance');

const item = (overrides = {}) => ({
  confirmed_balance: '5000000',
  currency: { decimals: 6 },
  ...overrides,
});

describe('computeUsdBalance', () => {
  it('converts a raw balance at the quoted price', () => {
    expect(computeUsdBalance(item(), 2)).toBe(10);
  });

  it('accepts a numeric balance', () => {
    expect(computeUsdBalance(item({ confirmed_balance: 5000000 }), 2)).toBe(10);
  });

  it('treats a missing or non-positive balance as zero', () => {
    expect(computeUsdBalance(item({ confirmed_balance: '0' }), 2)).toBe(0);
    expect(computeUsdBalance(item({ confirmed_balance: undefined }), 2)).toBe(0);
    expect(computeUsdBalance(item({ confirmed_balance: 'not-a-number' }), 2)).toBe(0);
  });

  it('defaults to zero decimals when the currency omits them', () => {
    expect(computeUsdBalance({ confirmed_balance: '3' }, 5)).toBe(15);
  });

  describe('scaled mints', () => {
    /**
     * A Scaled UI Amount mint is quoted per displayed unit — one AAPLx is one
     * Apple share — so the USD value has to follow the scaled amount. Pairing
     * that price with the raw balance understates the position by the
     * multiplier, which is the whole reason `_uiAmount` exists.
     */
    it('prices the scaled amount when the provider resolved one', () => {
      const scaled = item({
        confirmed_balance: '677400755573',
        currency: { decimals: 8 },
        _uiAmount: '6796.15187137',
      });
      expect(computeUsdBalance(scaled, 10)).toBeCloseTo(67961.5187137, 6);
    });

    it('differs from the raw figure by the multiplier', () => {
      const raw = item({ confirmed_balance: '677400755573', currency: { decimals: 8 } });
      const scaled = { ...raw, _uiAmount: '6796.15187137' };
      const ratio = computeUsdBalance(scaled, 1) / computeUsdBalance(raw, 1);
      // The UI amount is truncated at the mint's 8 decimals, so the recovered
      // multiplier trails the on-chain value in the last places.
      expect(ratio).toBeCloseTo(1.0032690125398187, 11);
    });

    it('falls back to the raw balance when the marker is unusable', () => {
      const broken = item({ _uiAmount: 'not-a-number' });
      expect(computeUsdBalance(broken, 2)).toBe(10);
    });

    it('reports zero for a scaled amount that rounds away', () => {
      expect(computeUsdBalance(item({ _uiAmount: '0' }), 2)).toBe(0);
    });
  });
});
