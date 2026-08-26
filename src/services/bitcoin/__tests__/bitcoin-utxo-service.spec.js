'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

const http = require('axios');
const service = require('../bitcoin-utxo-service');

describe('bitcoin-utxo-service', () => {
  const locals = {
    network: {
      id: 'bitcoin-mainnet',
      blockchain: 'bitcoin',
      environment: 'mainnet',
    },
  };
  const expectedHeaders = {
    'X-API-Key': process.env.UBIQUITY_API_KEY,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not cache: a repeated request walks upstream again', async () => {
    http.get.mockResolvedValue({ data: { data: [{ txid: 'utxo-1' }], meta: {} } });

    await service.getUtxo('btc-address', {}, locals);
    await service.getUtxo('btc-address', {}, locals);

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('paginates utxo responses until the next page token is exhausted', async () => {
    http.get
      .mockResolvedValueOnce({
        data: {
          data: [{ txid: 'utxo-1' }],
          meta: { paging: { next_page_token: 'next-1' } },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ txid: 'utxo-2' }],
          meta: { paging: {} },
        },
      });

    const result = await service.getUtxo('btc-address', { pageSize: 10 }, locals);

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      'https://svc.blockdaemon.com/universal/v1/bitcoin/mainnet/account/btc-address/utxo',
      {
        headers: expectedHeaders,
        params: { spent: false, order: 'desc', limit: 10 },
        timeout: 10000,
      }
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      'https://svc.blockdaemon.com/universal/v1/bitcoin/mainnet/account/btc-address/utxo',
      {
        headers: expectedHeaders,
        params: { spent: false, order: 'desc', limit: 10, continuation: 'next-1' },
        timeout: 10000,
      }
    );
    expect(result).toEqual({
      data: [
        { txid: 'utxo-1', address: 'btc-address' },
        { txid: 'utxo-2', address: 'btc-address' },
      ],
      meta: { nextPageToken: null },
    });
  });

  describe('page size bounds', () => {
    it.each([
      ['a value below the floor', 1, 10],
      ['a value above the ceiling', 100000, 100],
      ['a non-numeric value', 'abc', 100],
      ['an absent value', undefined, 100],
    ])('clamps %s', async (_label, pageSize, expected) => {
      http.get.mockResolvedValue({ data: { data: [], meta: {} } });

      await service.getUtxo('btc-address', { pageSize }, locals);

      expect(http.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ params: expect.objectContaining({ limit: expected }) })
      );
    });
  });
});
