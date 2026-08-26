'use strict';

const blockdaemonBalanceProvider = require('../blockdaemon-balance-provider');
const solanaBalanceProvider = require('../../../solana/solana-balance-provider');
const { resolveProvider } = require('..');

describe('balance-providers resolver', () => {
  it('returns the Blockdaemon default for Bitcoin', () => {
    expect(resolveProvider('bitcoin')).toBe(blockdaemonBalanceProvider);
  });

  it('returns the Solana-specific provider for Solana', () => {
    expect(resolveProvider('solana')).toBe(solanaBalanceProvider);
  });

  it('returns the Blockdaemon default for any unregistered chain', () => {
    expect(resolveProvider('ethereum')).toBe(blockdaemonBalanceProvider);
    expect(resolveProvider('unknown-chain')).toBe(blockdaemonBalanceProvider);
  });
});
