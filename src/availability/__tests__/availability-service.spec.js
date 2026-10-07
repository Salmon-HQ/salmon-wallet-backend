'use strict';

jest.mock('../../services/solana/powerups/powerup-catalog-service', () => ({
  listFor: jest.fn(),
}));
jest.mock('../../services/shared/network-capabilities-service', () => ({
  getPowerups: jest.fn(),
}));

const catalog = require('../../services/solana/powerups/powerup-catalog-service');
const { DEFAULT_TABLE } = require('../availability-table');
const { decide, listFor } = require('../availability-service');

const table = () => JSON.parse(JSON.stringify(DEFAULT_TABLE));

describe('availability-service', () => {
  describe('decide', () => {
    it('serves the default provider in a country with no row', () => {
      expect(decide(table(), 'swap', 'android', 'AR')).toEqual({
        enabled: true,
        provider: 'jupiter',
      });
    });

    it('refuses an unavailable country with reason region', () => {
      expect(decide(table(), 'swap', 'android', 'CU')).toEqual({
        enabled: false,
        reason: 'region',
      });
    });

    it('routes the United States to 0x on every platform', () => {
      for (const platform of ['ios', 'android', 'extension']) {
        expect(decide(table(), 'swap', platform, 'US')).toEqual({ enabled: true, provider: '0x' });
      }
    });

    it('routes a country in a provider row to that provider', () => {
      expect(decide(table(), 'swap', 'ios', 'CN')).toEqual({ enabled: true, provider: '0x' });
    });

    it('treats an unknown country as unrestricted, on the default provider', () => {
      expect(decide(table(), 'swap', 'ios', null)).toEqual({
        enabled: true,
        provider: 'jupiter',
      });
    });

    it('applies a platform override over the capability values', () => {
      const t = table();
      t.capabilities.swap.platforms.ios = { unavailable: ['CU', 'IR', 'KP', 'SY', 'US', 'AR'] };
      expect(decide(t, 'swap', 'ios', 'AR')).toEqual({ enabled: false, reason: 'region' });
      expect(decide(t, 'swap', 'android', 'AR')).toEqual({ enabled: true, provider: 'jupiter' });
    });

    it('switches a capability off on one platform, with the row reason', () => {
      const t = table();
      t.capabilities.swap.platforms.ios = { enabled: false, reason: 'maintenance' };
      expect(decide(t, 'swap', 'ios', 'AR')).toEqual({ enabled: false, reason: 'maintenance' });
      expect(decide(t, 'swap', 'ios', null)).toEqual({ enabled: false, reason: 'maintenance' });
      expect(decide(t, 'swap', 'android', 'AR')).toEqual({ enabled: true, provider: 'jupiter' });
    });

    it('switches a capability off everywhere, and lets one platform back on', () => {
      const t = table();
      t.capabilities.payments = {
        enabled: false,
        reason: 'deprecated',
        platforms: { extension: { enabled: true } },
      };
      expect(decide(t, 'payments', 'ios', 'AR')).toEqual({ enabled: false, reason: 'deprecated' });
      expect(decide(t, 'payments', 'extension', 'AR')).toEqual({ enabled: true });
    });

    it('leaves a capability the table does not mention enabled, with no provider', () => {
      expect(decide(table(), 'payments', 'ios', 'US')).toEqual({ enabled: true });
    });
  });

  describe('listFor', () => {
    beforeEach(() => {
      catalog.listFor.mockReturnValue([
        { id: 'payments', enabled: true },
        { id: 'memo', enabled: false, reason: 'maintenance' },
        { id: 'swap', enabled: true },
      ]);
    });

    it('merges the per-viewer decision into every enabled catalogue entry', () => {
      expect(listFor(table(), 'solana-mainnet', 'android', 'AR')).toEqual([
        { id: 'payments', enabled: true },
        { id: 'memo', enabled: false, reason: 'maintenance' },
        { id: 'swap', enabled: true, provider: 'jupiter' },
      ]);
      expect(catalog.listFor).toHaveBeenCalledWith('solana-mainnet');
    });

    it('marks swap unavailable by region for a blocked country', () => {
      expect(listFor(table(), 'solana-mainnet', 'ios', 'IR')).toContainEqual({
        id: 'swap',
        enabled: false,
        reason: 'region',
      });
    });

    it('offers swap through 0x in the United States', () => {
      expect(listFor(table(), 'solana-mainnet', 'ios', 'US')).toContainEqual({
        id: 'swap',
        enabled: true,
        provider: '0x',
      });
    });

    it('keeps the stage reason when the stage disables swap, without consulting the table', () => {
      catalog.listFor.mockReturnValue([{ id: 'swap', enabled: false, reason: 'maintenance' }]);
      expect(listFor(table(), 'solana-mainnet', 'ios', 'AR')).toEqual([
        { id: 'swap', enabled: false, reason: 'maintenance' },
      ]);
    });
  });
});
