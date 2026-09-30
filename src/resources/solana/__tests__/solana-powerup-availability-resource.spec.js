'use strict';

const decorate = require('../solana-powerup-availability-resource');

describe('solana-powerup-availability-resource', () => {
  it('keeps reason only when disabled and provider only when enabled', () => {
    expect(decorate({ id: 'payments', enabled: true })).toEqual({ id: 'payments', enabled: true });
    expect(decorate({ id: 'swap', enabled: true, provider: 'jupiter' })).toEqual({
      id: 'swap',
      enabled: true,
      provider: 'jupiter',
    });
    expect(decorate({ id: 'swap', enabled: false, reason: 'region', provider: 'jupiter' })).toEqual(
      { id: 'swap', enabled: false, reason: 'region' }
    );
  });
});
