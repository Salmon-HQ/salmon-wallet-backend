'use strict';

jest.mock('../registry', () => ({
  POWERUPS: {
    swap: { tier: 'core', networks: ['solana-mainnet'], contributor: null },
    stake: { tier: 'community', networks: ['solana-mainnet', 'solana-devnet'], contributor: null },
    unlisted: { tier: 'community', networks: ['solana-mainnet'], contributor: null },
  },
}));

const { listFor } = require('../powerup-catalog-service');

const stage = {
  swap: { enabled: true },
  stake: { enabled: false, reason: 'maintenance' },
  ghost: { enabled: true },
};

describe('powerup-catalog-service', () => {
  it('lists registry ∩ stage ∩ declared networks, reason only when disabled', () => {
    expect(listFor('solana-mainnet', stage)).toEqual([
      { id: 'swap', enabled: true },
      { id: 'stake', enabled: false, reason: 'maintenance' },
    ]);
  });

  it('respects the declared networks and answers [] where nothing is declared', () => {
    expect(listFor('solana-devnet', stage)).toEqual([
      { id: 'stake', enabled: false, reason: 'maintenance' },
    ]);
    expect(listFor('bitcoin-mainnet', stage)).toEqual([]);
  });

  it('ignores a stage id the registry does not know', () => {
    expect(listFor('solana-mainnet', stage).map((p) => p.id)).not.toContain('ghost');
  });
});
