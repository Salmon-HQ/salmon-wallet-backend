'use strict';

jest.mock('../../../infrastructure/esplora-client', () => ({ get: jest.fn() }));

const esplora = require('../../../infrastructure/esplora-client');
const provider = require('../bitcoin-balance-provider');
const decorateBalance = require('../../../resources/shared/account-balance-resource');

const locals = { network: { blockchain: 'bitcoin', environment: 'mainnet' } };

describe('bitcoin-balance-provider', () => {
  it('reports the mined balance as the amount, mempool apart', async () => {
    esplora.get.mockResolvedValue({
      chain_stats: { funded_txo_sum: 150000, spent_txo_sum: 41796 },
      mempool_stats: { funded_txo_sum: 500, spent_txo_sum: 0 },
    });

    const [item] = await provider.getBalance('bc1q-me', undefined, locals);

    expect(esplora.get).toHaveBeenCalledWith('/address/bc1q-me', locals);
    expect(item).toMatchObject({ confirmed_balance: '108204', pending_balance: '108704' });
    expect(await decorateBalance(item, [], undefined, {})).toEqual({
      owner: 'bc1q-me',
      blockchain: 'bitcoin',
      amount: '108204',
      decimals: 8,
      symbol: 'BTC',
      name: 'Bitcoin',
      type: 'native',
      address: 'btc',
      coingeckoId: 'bitcoin',
    });
  });
});
