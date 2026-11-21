'use strict';

/**
 * Abuse case: cache busting. The history route is anonymous and every cache
 * miss is a call to the Esplora provider, so only what the loader reads may
 * separate two first-page requests.
 */

jest.mock('../../../infrastructure/esplora-client', () => ({ get: jest.fn() }));

const fc = require('fast-check');
const esplora = require('../../../infrastructure/esplora-client');
const service = require('../bitcoin-transaction-service');
const {
  clearTransactionHistoryCache,
} = require('../../../infrastructure/cache/transaction-history-cache');

const locals = {
  network: { id: 'bitcoin-mainnet', blockchain: 'bitcoin', environment: 'mainnet' },
};

const providerCallsFor = async (queries) => {
  clearTransactionHistoryCache();
  esplora.get.mockReset().mockResolvedValue([]);

  for (const query of queries) {
    await service.getTransactions('bc1q-viewed', query, locals);
  }
  return esplora.get.mock.calls.length;
};

describe('[API4:2023] abuse: cache busting through the history query string', () => {
  test('parameters the loader does not read never cost a second provider call', async () => {
    const junk = fc
      .dictionary(fc.string(), fc.string())
      .map(({ pageSize: _p, pageToken: _t, before: _b, continuation: _c, ...rest }) => rest);

    await fc.assert(
      fc.asyncProperty(fc.array(junk, { minLength: 2, maxLength: 5 }), async (queries) => {
        expect(await providerCallsFor(queries)).toBe(1);
      }),
      { numRuns: 50 }
    );
  });

  test('page sizes the loader serves the same way are one request', async () => {
    expect(
      await providerCallsFor([{}, { pageSize: 'abc' }, { pageSize: '100' }, { pageSize: '5000' }])
    ).toBe(1);
  });

  test('a page size the loader serves differently still gets its own answer', async () => {
    expect(await providerCallsFor([{ pageSize: '10' }, { pageSize: '20' }])).toBe(2);
  });
});
