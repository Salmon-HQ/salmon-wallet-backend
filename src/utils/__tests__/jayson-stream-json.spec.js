'use strict';

/**
 * `jayson`'s `stream-json` is overridden to 3.x (GHSA-528h-pc64-c93x): the
 * 1.x line has no fixed release. 3.x is ESM with other module paths, so the
 * jayson code that requires it (`lib/utils`) would break — and nothing here
 * loads it: web3.js uses only jayson's browser client. This pins both facts:
 * an RPC call still works, and `stream-json` never loads.
 */

const loaded = [];
jest.mock('stream-json/streamers/StreamValues', () => loaded.push('StreamValues'), {
  virtual: true,
});
jest.mock('stream-json/utils/Verifier', () => loaded.push('Verifier'), { virtual: true });

const { Connection, Keypair } = require('@solana/web3.js');

describe('jayson without stream-json', () => {
  it('serves a web3.js RPC call without loading stream-json', async () => {
    const fetch = async (_url, init) => {
      const { id } = JSON.parse(init.body);
      const body = { jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: 5 } };
      return new globalThis.Response(JSON.stringify(body), { status: 200 });
    };
    const connection = new Connection('http://rpc.invalid', { fetch });

    await expect(connection.getBalance(Keypair.generate().publicKey)).resolves.toBe(5);
    expect(loaded).toEqual([]);
  });
});
