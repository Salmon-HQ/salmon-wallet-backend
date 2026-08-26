'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

const http = require('axios');
const provider = require('../blockdaemon-balance-provider');

describe('blockdaemon-balance-provider', () => {
  const expectedHeaders = {
    'X-API-Key': process.env.UBIQUITY_API_KEY,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads balances and decorates them with owner and blockchain', async () => {
    http.get.mockResolvedValue({
      data: [{ id: 'bal-1', amount: '1.23' }],
    });

    const result = await provider.getBalance('btc-address', undefined, {
      network: {
        id: 'bitcoin-mainnet',
        blockchain: 'bitcoin',
        environment: 'mainnet',
      },
    });

    expect(http.get).toHaveBeenCalledWith(
      'https://svc.blockdaemon.com/universal/v1/bitcoin/mainnet/account/btc-address',
      {
        headers: expectedHeaders,
        params: {},
        timeout: 6000,
      }
    );
    expect(result).toEqual([
      {
        id: 'bal-1',
        amount: '1.23',
        owner: 'btc-address',
        blockchain: 'bitcoin',
      },
    ]);
  });

  it('routes to the chain implied by locals.network.blockchain', async () => {
    http.get.mockResolvedValue({
      data: [{ id: 'bal-1', amount: '1.23' }],
    });

    await provider.getBalance('sol-address', undefined, {
      network: {
        id: 'solana-mainnet',
        blockchain: 'solana',
        environment: 'mainnet',
      },
    });

    expect(http.get).toHaveBeenCalledWith(
      'https://svc.blockdaemon.com/universal/v1/solana/mainnet/account/sol-address',
      expect.objectContaining({ timeout: 6000 })
    );
  });
});
