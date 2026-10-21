'use strict';

const util = require('util');
const { AxiosError } = require('axios');
const wrap = require('../handler');

describe('Lambda handler wrapper', () => {
  it('never logs a provider credential carried on an escaped axios error', async () => {
    const key = 'provider-secret-key-1234567890';
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new AxiosError(
      'Request failed with status code 500',
      'ERR_BAD_RESPONSE',
      { url: `https://tenant.solana-mainnet.rpcpool.com/${key}`, headers: { 'x-api-key': key } },
      { _header: `POST / HTTP/1.1\r\nx-api-key: ${key}\r\n\r\n` },
      { status: 500, data: {}, headers: {} }
    );

    await wrap(() => Promise.reject(failure))({}, {});

    const printed = error.mock.calls.map((args) => util.format(...args)).join('\n');
    expect(printed).toContain('Request failed with status code 500');
    expect(printed).not.toContain(key);
    error.mockRestore();
  });
});
