'use strict';

const resource = require('../solana-powerup-build-resource');

const build = (display) => ({
  transaction: 'base64-unsigned-transaction',
  expiresAt: '2026-10-26T12:00:00.000Z',
  provider: { id: 'memo', displayName: 'SPL Memo', attribution: null },
  contributor: null,
  priorityFeeMicroLamports: 1000,
  computeUnitLimit: 200000,
  display,
});

describe('solana-powerup-build-resource', () => {
  it('publishes the scalar display fields an adapter returns', () => {
    const body = resource(build({ note: 'gm', noteBytes: 2, final: true, memo: null }));

    expect(body).toMatchObject({ note: 'gm', noteBytes: 2, final: true, memo: null });
  });

  it('drops display values that are objects, so an adapter cannot publish its context', () => {
    const token = 'triton-secret-token-1234567890';
    const connection = { _rpcEndpoint: `https://tenant.solana-mainnet.rpcpool.com/${token}` };

    const body = resource(build({ note: 'gm', connection, list: [connection] }));

    expect(body.note).toBe('gm');
    expect(body).not.toHaveProperty('connection');
    expect(body).not.toHaveProperty('list');
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('never lets a display field replace an envelope field', () => {
    const body = resource(build({ transaction: 'attacker-transaction', contributor: 'someone' }));

    expect(body.transaction).toBe('base64-unsigned-transaction');
    expect(body.contributor).toBeNull();
  });
});
