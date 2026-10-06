'use strict';

jest.mock('../../../infrastructure/esplora-client', () => ({ get: jest.fn() }));

const esplora = require('../../../infrastructure/esplora-client');
const service = require('../bitcoin-transaction-service');
const {
  clearTransactionHistoryCache,
} = require('../../../infrastructure/cache/transaction-history-cache');

const ADDRESS = 'bc1q-viewed';
const locals = {
  network: { id: 'bitcoin-mainnet', blockchain: 'bitcoin', environment: 'mainnet' },
};

const tx = (txid, confirmed = true) => ({
  txid,
  fee: 141,
  status: confirmed ? { confirmed: true, block_time: 1700000000 } : { confirmed: false },
  vin: [{ prevout: { scriptpubkey_address: 'bc1q-sender', value: 5000 } }],
  vout: [{ scriptpubkey_address: ADDRESS, value: 4859, scriptpubkey: '0014ab' }],
});
const confirmedRun = (prefix, n) => Array.from({ length: n }, (_, i) => tx(`${prefix}${i}`));

describe('bitcoin-transaction-service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    clearTransactionHistoryCache();
  });

  it('maps an Esplora transaction into the fee / input / output events the resource reads', async () => {
    esplora.get.mockResolvedValue([tx('a')]);

    const page = await service.getTransactions(ADDRESS, { pageSize: 10 }, locals);

    expect(esplora.get).toHaveBeenCalledWith(`/address/${ADDRESS}/txs`, locals);
    expect(page).toEqual({
      data: [
        {
          id: 'a',
          date: 1700000000,
          status: 'completed',
          blockchain: 'bitcoin',
          address: ADDRESS,
          events: [
            { type: 'fee', denomination: 'BTC', decimals: 8, amount: 141 },
            {
              type: 'utxo_input',
              denomination: 'BTC',
              decimals: 8,
              source: 'bc1q-sender',
              amount: 5000,
            },
            {
              type: 'utxo_output',
              denomination: 'BTC',
              decimals: 8,
              destination: ADDRESS,
              amount: 4859,
            },
          ],
        },
      ],
      meta: { nextPageToken: undefined },
    });
  });

  it('lists mined transactions only, and skips coinbase inputs', async () => {
    const coinbase = { ...tx('cb'), vin: [{ is_coinbase: true, prevout: null }] };
    esplora.get.mockResolvedValue([tx('m', false), coinbase]);

    const { data } = await service.getTransactions(ADDRESS, { pageSize: 10 }, locals);

    expect(data.map((t) => [t.id, t.status, t.date])).toEqual([['cb', 'completed', 1700000000]]);
    expect(data[0].events.some((e) => e.type === 'utxo_input')).toBe(false);
  });

  it('fills the page across Esplora chunks and continues from the last txid', async () => {
    esplora.get
      .mockResolvedValueOnce(confirmedRun('p', 25))
      .mockResolvedValueOnce(confirmedRun('q', 25));

    const page = await service.getTransactions(ADDRESS, { pageSize: 30 }, locals);

    expect(esplora.get).toHaveBeenNthCalledWith(2, `/address/${ADDRESS}/txs/chain/p24`, locals);
    expect(page.data).toHaveLength(30);
    expect(page.meta.nextPageToken).toBe('q4');
  });

  it('keeps paging when the first chunk is longer than a chain page (mempool.space sends 50)', async () => {
    esplora.get
      .mockResolvedValueOnce(confirmedRun('p', 50))
      .mockResolvedValueOnce(confirmedRun('q', 25))
      .mockResolvedValueOnce(confirmedRun('r', 25));

    const page = await service.getTransactions(ADDRESS, { pageSize: 100 }, locals);

    expect(page.data).toHaveLength(100);
    expect(page.meta.nextPageToken).toBe('r24');
  });

  it('ends the history when Esplora returns a short chunk', async () => {
    esplora.get.mockResolvedValueOnce(confirmedRun('p', 25)).mockResolvedValueOnce([tx('last')]);

    const page = await service.getTransactions(ADDRESS, { pageSize: 100 }, locals);

    expect(page.data).toHaveLength(26);
    expect(page.meta.nextPageToken).toBeUndefined();
  });

  it('reads a later page from the chain endpoint after the token', async () => {
    esplora.get.mockResolvedValue([tx('z')]);

    await service.getTransactions(ADDRESS, { pageToken: 'p9', pageSize: 10 }, locals);

    expect(esplora.get).toHaveBeenCalledWith(`/address/${ADDRESS}/txs/chain/p9`, locals);
  });

  it('caches the first page but never a later one', async () => {
    esplora.get.mockResolvedValue([tx('a')]);

    await service.getTransactions(ADDRESS, { pageSize: 10 }, locals);
    await service.getTransactions(ADDRESS, { pageSize: 10 }, locals);
    expect(esplora.get).toHaveBeenCalledTimes(1);

    await service.getTransactions(ADDRESS, { pageToken: 'a', pageSize: 10 }, locals);
    await service.getTransactions(ADDRESS, { pageToken: 'a', pageSize: 10 }, locals);
    expect(esplora.get).toHaveBeenCalledTimes(3);
  });
});
