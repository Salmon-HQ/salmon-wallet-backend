'use strict';

/**
 * Abuse case: request forgery against the upstream through the history
 * cursor. `pageToken` becomes a path segment of the Esplora request, so a
 * caller who can put `../` or `?` in it chooses which upstream endpoint this
 * API calls on their behalf. Reported privately as GHSA-rc33-w554-98xv.
 */

jest.mock('../../../infrastructure/esplora-client', () => ({ get: jest.fn() }));

const http = require('node:http');
const express = require('express');
const fc = require('fast-check');
const esplora = require('../../../infrastructure/esplora-client');
const router = require('../bitcoin-account-router');
const {
  clearTransactionHistoryCache,
} = require('../../../infrastructure/cache/transaction-history-cache');

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const TXID = 'a'.repeat(64);

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.network = { id: 'bitcoin-mainnet', blockchain: 'bitcoin', environment: 'mainnet' };
    next();
  });
  app.use(router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  clearTransactionHistoryCache();
  esplora.get.mockReset().mockResolvedValue([]);
});

const history = (pageToken) =>
  fetch(`${base}/${ADDRESS}/transactions?pageToken=${encodeURIComponent(pageToken)}`);

describe('[API7:2023] abuse: steering the upstream request through the history cursor', () => {
  test.each([
    ['a traversal to another endpoint', '../../tx/deadbeef'],
    ['a traversal to another address', '../../../address/mjRg8SqYoZuGaVC5VWGHhZ6uV58PDw6tC/utxo'],
    ['an injected query string', 'x?foo=bar'],
    ['an encoded traversal', '%2e%2e%2f%2e%2e%2ftx'],
    ['a txid with a suffix', `${TXID}/../x`],
    ['a short hex string', 'deadbeef'],
  ])('%s is refused with 400 and never reaches the upstream', async (_label, pageToken) => {
    const response = await history(pageToken);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_parameter');
    expect(esplora.get).not.toHaveBeenCalled();
  });

  test('whatever the cursor, the upstream path is the chain endpoint of the address asked for', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (pageToken) => {
        esplora.get.mockClear();
        await history(pageToken);

        for (const [path] of esplora.get.mock.calls) {
          expect(path).toMatch(new RegExp(`^/address/${ADDRESS}/txs/chain/[0-9a-f]{64}$`, 'i'));
        }
      }),
      { numRuns: 100 }
    );
  });

  test('a real transaction id still pages', async () => {
    const response = await history(TXID);

    expect(response.status).toBe(200);
    expect(esplora.get).toHaveBeenCalledWith(
      `/address/${ADDRESS}/txs/chain/${TXID}`,
      expect.anything()
    );
  });
});
