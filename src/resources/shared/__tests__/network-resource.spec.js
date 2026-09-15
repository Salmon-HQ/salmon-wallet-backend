'use strict';

const resource = require('../network-resource');

describe('network-resource', () => {
  test('returns stable public payload for network catalog entries', () => {
    expect(
      resource({
        id: 'solana-mainnet',
        blockchain: 'solana',
        environment: 'mainnet',
        name: 'Solana',
        icon: 'https://example.com/solana.png',
        currency: { symbol: 'SOL', decimals: 9 },
        config: { nodeUrl: 'https://rpc.example' },
        enabled: true,
        sections: {
          collectibles: { active: true },
        },
        ignored: 'value',
      })
    ).toEqual({
      id: 'solana-mainnet',
      blockchain: 'solana',
      environment: 'mainnet',
      name: 'Solana',
      icon: 'https://example.com/solana.png',
      currency: { symbol: 'SOL', decimals: 9 },
      config: { nodeUrl: 'https://rpc.example' },
      enabled: true,
      sections: {
        collectibles: { active: true },
      },
      powerups: [],
      attribution: null,
    });
  });

  test('passes the powerups list through, reason included', () => {
    const powerups = [{ id: 'stake', enabled: false, reason: 'maintenance' }];

    expect(resource({ id: 'solana-mainnet', powerups }).powerups).toEqual(powerups);
  });
});
