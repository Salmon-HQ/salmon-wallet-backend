'use strict';

jest.mock('../../../constants/networks', () => [
  {
    id: 'solana-mainnet',
    blockchain: 'solana',
    environment: 'mainnet',
    name: 'Solana',
    config: { nodeUrl: 'https://rpc.example' },
  },
  {
    id: 'ethereum-mainnet',
    blockchain: 'ethereum',
    environment: 'mainnet',
    name: 'Ethereum Mainnet',
    config: { rpcUrl: 'https://eth.example' },
  },
]);

jest.mock('../network-capabilities-service', () => ({
  get: jest.fn(),
}));

const networkCapabilitiesService = require('../network-capabilities-service');
const service = require('../network-catalog-service');

describe('network-catalog-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('merges network capabilities config into network list', () => {
    networkCapabilitiesService.get.mockReturnValue({
      'solana-mainnet': {
        enable: true,
        sections: {
          swap: { active: true },
        },
      },
    });

    expect(service.list()).toEqual([
      expect.objectContaining({
        id: 'solana-mainnet',
        enabled: true,
        sections: {
          swap: { active: true },
        },
      }),
      expect.objectContaining({
        id: 'ethereum-mainnet',
        enabled: false,
        sections: {},
      }),
    ]);
  });

  test('finds a network by id from the merged catalog', () => {
    networkCapabilitiesService.get.mockReturnValue({
      'ethereum-mainnet': {
        enable: false,
        sections: {
          exchange: { active: false },
        },
      },
    });

    expect(service.show('ethereum-mainnet')).toEqual(
      expect.objectContaining({
        id: 'ethereum-mainnet',
        enabled: false,
        sections: {
          exchange: { active: false },
        },
      })
    );
  });

  describe('misconfigured stage', () => {
    it('fails with 503 instead of reporting a catalog where nothing is enabled', () => {
      networkCapabilitiesService.get.mockReturnValue(undefined);

      // Answering 200 with every network enabled:false reads to the wallet as
      // "this build supports no networks", and it caches that for the session
      // while CloudFront holds it for an hour.
      expect(() => service.list()).toThrow(
        expect.objectContaining({
          statusCode: 503,
          errorCode: 'network_catalog_unavailable',
        })
      );
    });
  });
});
