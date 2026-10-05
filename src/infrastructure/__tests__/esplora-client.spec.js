'use strict';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../providers/provider-client', () => ({
  providerCall: jest.fn((name, fn) => fn({ timeout: 10000, signal: undefined })),
}));

const http = require('axios');
const { providerCall } = require('../providers/provider-client');
const esplora = require('../esplora-client');

const mainnet = { network: { environment: 'mainnet' } };

describe('esplora-client', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads mempool.space first, under its own provider profile', async () => {
    http.get.mockResolvedValue({ data: { ok: 1 } });

    expect(await esplora.get('/address/a', mainnet)).toEqual({ ok: 1 });
    expect(http.get).toHaveBeenCalledWith(
      'https://mempool.space/api/address/a',
      expect.any(Object)
    );
    expect(providerCall).toHaveBeenCalledWith('mempool', expect.any(Function), expect.any(Object));
  });

  it('uses the testnet hosts for the testnet network', async () => {
    http.get.mockResolvedValue({ data: [] });

    await esplora.get('/address/tb1/utxo', { network: { environment: 'testnet' } });

    expect(http.get.mock.calls[0][0]).toBe('https://mempool.space/testnet/api/address/tb1/utxo');
  });

  it('moves to blockstream when mempool.space is down', async () => {
    http.get
      .mockRejectedValueOnce(Object.assign(new Error('502'), { response: { status: 502 } }))
      .mockResolvedValueOnce({ data: { ok: 2 } });

    expect(await esplora.get('/address/a', mainnet)).toEqual({ ok: 2 });
    expect(http.get.mock.calls[1][0]).toBe('https://blockstream.info/api/address/a');
  });

  it('does not ask the second host when the first refuses the input (4xx)', async () => {
    const bad = Object.assign(new Error('400'), { response: { status: 400 } });
    http.get.mockRejectedValue(bad);

    await expect(esplora.get('/address/nope', mainnet)).rejects.toBe(bad);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('throws the last error when both hosts fail', async () => {
    http.get
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
      .mockRejectedValueOnce(Object.assign(new Error('503'), { response: { status: 503 } }));

    await expect(esplora.get('/address/a', mainnet)).rejects.toThrow('503');
  });
});
