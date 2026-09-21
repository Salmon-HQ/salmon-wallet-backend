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
        config: { nodeUrl: 'https://rpc.example', publicNodeUrl: 'https://public.example' },
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
      config: { nodeUrl: 'https://public.example' },
      enabled: true,
      sections: {
        collectibles: { active: true },
      },
      powerups: [],
      attribution: null,
    });
  });

  // `config.nodeUrl` holds the provider credential (Triton token path segment,
  // Helius `?api-key=`), so the internal value must never reach the response.
  test.each([
    ['helius', 'https://mainnet.helius-rpc.com/?api-key=SECRET-KEY'],
    ['triton', 'https://tenant.solana-mainnet.rpcpool.com/SECRET-TOKEN'],
  ])('never publishes the %s credentialed node url', (_label, nodeUrl) => {
    const { config } = resource({ id: 'solana-mainnet', config: { nodeUrl } });

    expect(JSON.stringify(config)).not.toContain('SECRET');
    expect(config.nodeUrl).toBeUndefined();
  });

  test('publishes only allow-listed config keys', () => {
    const { config } = resource({
      id: 'ethereum-mainnet',
      config: {
        rpcUrl: 'https://eth.example',
        chainId: 1,
        nodeUrl: 'https://secret',
        apiKey: 'nope',
      },
    });

    expect(config).toEqual({ rpcUrl: 'https://eth.example', chainId: 1 });
  });

  test('passes the powerups list through, reason included', () => {
    const powerups = [{ id: 'stake', enabled: false, reason: 'maintenance' }];

    expect(resource({ id: 'solana-mainnet', powerups }).powerups).toEqual(powerups);
  });
});
