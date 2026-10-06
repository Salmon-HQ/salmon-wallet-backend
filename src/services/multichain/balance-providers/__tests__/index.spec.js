'use strict';

const bitcoinBalanceProvider = require('../../../bitcoin/bitcoin-balance-provider');
const solanaBalanceProvider = require('../../../solana/solana-balance-provider');
const { resolveProvider } = require('..');

describe('balance-providers resolver', () => {
  it('returns the Bitcoin provider for Bitcoin', () => {
    expect(resolveProvider('bitcoin')).toBe(bitcoinBalanceProvider);
  });

  it('returns the Solana provider for Solana', () => {
    expect(resolveProvider('solana')).toBe(solanaBalanceProvider);
  });

  it('throws for a chain with no registered provider', () => {
    expect(() => resolveProvider('ethereum')).toThrow(/No balance provider registered/);
  });
});
