'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

const http = require('axios');
const service = require('../bitcoin-transaction-service');
const {
  clearTransactionHistoryCache,
} = require('../../../infrastructure/cache/transaction-history-cache');

describe('bitcoin-transaction-service', () => {
  const locals = {
    network: {
      id: 'bitcoin-mainnet',
      blockchain: 'bitcoin',
      environment: 'mainnet',
    },
  };
  beforeEach(() => {
    jest.clearAllMocks();
    clearTransactionHistoryCache();
  });

  it('caches first-page transaction history by address, query, and network', async () => {
    http.get.mockResolvedValue({
      data: {
        data: [{ id: 'tx-1' }],
        meta: { paging: { next_page_token: 'next-1' } },
      },
    });

    const first = await service.getTransactions('btc-address', { pageSize: 10 }, locals);
    const second = await service.getTransactions('btc-address', { pageSize: 10 }, locals);

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).toEqual({
      data: [{ id: 'tx-1', blockchain: 'bitcoin', address: 'btc-address' }],
      meta: { nextPageToken: 'next-1' },
    });
  });

  it('does not cache paginated transaction history requests', async () => {
    http.get
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'tx-1' }],
          meta: { paging: { next_page_token: 'next-1' } },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'tx-2' }],
          meta: { paging: { next_page_token: 'next-2' } },
        },
      });

    const first = await service.getTransactions('btc-address', { pageToken: 'page-1' }, locals);
    const second = await service.getTransactions('btc-address', { pageToken: 'page-1' }, locals);

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(first.data[0].id).toBe('tx-1');
    expect(second.data[0].id).toBe('tx-2');
  });

  it('deduplicates concurrent first-page transaction history requests', async () => {
    let resolveRequest;
    http.get.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const first = service.getTransactions('btc-address', {}, locals);
    const second = service.getTransactions('btc-address', {}, locals);

    await Promise.resolve();

    expect(http.get).toHaveBeenCalledTimes(1);

    resolveRequest({
      data: {
        data: [{ id: 'tx-1' }],
        meta: { paging: {} },
      },
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        data: [{ id: 'tx-1', blockchain: 'bitcoin', address: 'btc-address' }],
        meta: { nextPageToken: undefined },
      },
      {
        data: [{ id: 'tx-1', blockchain: 'bitcoin', address: 'btc-address' }],
        meta: { nextPageToken: undefined },
      },
    ]);
  });
});
