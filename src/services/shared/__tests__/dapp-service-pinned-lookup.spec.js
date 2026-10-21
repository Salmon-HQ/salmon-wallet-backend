'use strict';

/**
 * The pinned lookup through a real axios request and a real socket: the
 * other dapp-service specs mock axios, so they never exercised the callback
 * contract Node's connect (through axios) calls the lookup with. A lookup
 * that returns instead of calling back leaves the socket waiting until the
 * request is aborted.
 */

const http = require('http');

jest.mock('../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn(async (name, fn) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      return await fn({ timeout: 2000, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }),
}));
jest.mock('../dapp-url-guard', () => {
  const actual = jest.requireActual('../dapp-url-guard');
  return { ...actual, assertFetchableUrl: jest.fn() };
});

const { assertFetchableUrl } = require('../dapp-url-guard');
const { getMetadata } = require('../dapp-service');

describe('dapp-service pinned lookup', () => {
  let server;
  let hostHeader;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hostHeader = req.headers.host;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head><meta property="og:site_name" content="Pinned"></head></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('connects a hostname to the address the guard validated', async () => {
    const url = `http://dapp.example:${server.address().port}/`;
    // The guard resolved the hostname and pinned this address; the fetch must
    // connect to it and keep the hostname in the Host header.
    assertFetchableUrl.mockResolvedValue({ url: new URL(url), address: '127.0.0.1', family: 4 });

    const metadata = await getMetadata(url);

    expect(metadata.name).toBe('Pinned');
    expect(hostHeader).toBe(`dapp.example:${server.address().port}`);
  });
});
