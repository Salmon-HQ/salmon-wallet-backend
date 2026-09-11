'use strict';

jest.mock('../registry', () => ({
  POWERUPS: {
    swap: { tier: 'core', networks: ['solana-mainnet'], contributor: null },
    stake: { tier: 'community', networks: ['solana-mainnet', 'solana-devnet'], contributor: null },
    unlisted: { tier: 'community', networks: ['solana-mainnet'], contributor: null },
  },
}));
jest.mock('../../../shared/network-capabilities-service', () => ({
  get: jest.fn(),
  getPowerups: jest.fn(),
}));

const capabilities = require('../../../shared/network-capabilities-service');
const { listFor, isOffered } = require('../powerup-catalog-service');

describe('powerup-catalog-service', () => {
  beforeEach(() => {
    capabilities.get.mockReturnValue({
      'solana-mainnet': { enable: true },
      'solana-devnet': { enable: false },
      'bitcoin-mainnet': { enable: true },
    });
    capabilities.getPowerups.mockReturnValue({
      swap: { enabled: true },
      stake: { enabled: false, reason: 'maintenance' },
      ghost: { enabled: true },
    });
  });

  it('lists registry ∩ stage ∩ declared networks, reason only when disabled', () => {
    expect(listFor('solana-mainnet')).toEqual([
      { id: 'swap', enabled: true },
      { id: 'stake', enabled: false, reason: 'maintenance' },
    ]);
  });

  it('answers [] on a stage-disabled network and where nothing is declared', () => {
    expect(listFor('solana-devnet')).toEqual([]);
    expect(listFor('bitcoin-mainnet')).toEqual([]);
  });

  it('ignores a stage id the registry does not know', () => {
    expect(listFor('solana-mainnet').map((p) => p.id)).not.toContain('ghost');
  });

  it('throws 503 network_catalog_unavailable when the stage config is invalid', () => {
    capabilities.getPowerups.mockReturnValue(undefined);

    expect(() => listFor('solana-mainnet')).toThrow(
      expect.objectContaining({ statusCode: 503, errorCode: 'network_catalog_unavailable' })
    );
  });

  it('isOffered is the catalog predicate: listed and enabled on that network', () => {
    expect(isOffered('swap', 'solana-mainnet')).toBe(true);
    expect(isOffered('stake', 'solana-mainnet')).toBe(false);
    expect(isOffered('swap', 'solana-devnet')).toBe(false);
    expect(isOffered('unlisted', 'solana-mainnet')).toBe(false);
  });
});
