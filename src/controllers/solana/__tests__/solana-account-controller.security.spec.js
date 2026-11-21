'use strict';

/**
 * Abuse case: cache busting. The history route is anonymous and every cache
 * miss is a paid provider call, so a caller who can mint a fresh cache key at
 * will turns the cache off for themselves and pushes everyone else's answers
 * out of it. Only what the service reads may separate two requests.
 */

jest.mock('../../../../packages/api-utils', () => ({
  decorator: jest.fn(async (_resource, data) => data),
}));
jest.mock('../../../resources/solana/solana-transaction-resource', () =>
  jest.fn(async (data) => data)
);
jest.mock('../../../services/solana/solana-transaction-service');

const fc = require('fast-check');
const controller = require('../solana-account-controller');
const transactionService = require('../../../services/solana/solana-transaction-service');
const {
  clearTransactionHistoryCache,
} = require('../../../infrastructure/cache/transaction-history-cache');

const ADDRESS = 'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9';
// Parameters that mark a later page, which is never cached.
const CURSORS = ['pageToken', 'before', 'continuation'];

const providerCallsFor = async (queries) => {
  clearTransactionHistoryCache();
  transactionService.getTransactions.mockReset().mockResolvedValue({ data: [], meta: {} });

  for (const query of queries) {
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
      json: jest.fn(),
      locals: { network: { id: 'solana-mainnet', environment: 'mainnet', config: {} } },
    };
    await controller.listTransactions({ params: { address: ADDRESS }, query }, res);
  }
  return transactionService.getTransactions.mock.calls.length;
};

describe('[API4:2023] abuse: cache busting through the history query string', () => {
  test('parameters the service does not read never cost a second provider call', async () => {
    const junk = fc
      .dictionary(fc.string(), fc.string())
      .map(({ pageSize: _p, includeSpam: _s, ...rest }) =>
        Object.fromEntries(Object.entries(rest).filter(([key]) => !CURSORS.includes(key)))
      );

    await fc.assert(
      fc.asyncProperty(fc.array(junk, { minLength: 2, maxLength: 5 }), async (queries) => {
        expect(await providerCallsFor(queries)).toBe(1);
      }),
      { numRuns: 50 }
    );
  });

  test('spellings of one page size are one request', async () => {
    const queries = ['10', '010', ' 10', '10.9', '10abc', ['10', '20']].map((pageSize) => ({
      pageSize,
    }));

    expect(await providerCallsFor(queries)).toBe(1);
  });

  test('page sizes outside what any path serves collapse to the nearest one served', async () => {
    expect(await providerCallsFor([{ pageSize: '100' }, { pageSize: '101' }, { pageSize: '9e9' }]))
      // '9e9' reads as 9, like the service reads it
      .toBe(2);
    expect(await providerCallsFor([{ pageSize: '0' }, { pageSize: '-5' }, { pageSize: '1' }])).toBe(
      1
    );
  });

  test('spellings of includeSpam are one request', async () => {
    expect(await providerCallsFor([{ includeSpam: 'true' }, { includeSpam: 'TRUE' }])).toBe(1);
    expect(
      await providerCallsFor([
        {},
        { includeSpam: 'false' },
        { includeSpam: '1' },
        { includeSpam: {} },
      ])
    ).toBe(1);
  });

  test('what the service does read still gets its own answer', async () => {
    expect(await providerCallsFor([{ pageSize: '10' }, { pageSize: '20' }])).toBe(2);
    expect(await providerCallsFor([{}, { includeSpam: 'true' }])).toBe(2);
  });
});
