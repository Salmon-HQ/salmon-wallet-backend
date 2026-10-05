'use strict';

jest.mock('../../../infrastructure/esplora-client', () => ({ get: jest.fn() }));

const esplora = require('../../../infrastructure/esplora-client');
const service = require('../bitcoin-utxo-service');
const decorateUtxo = require('../../../resources/bitcoin/bitcoin-utxo-resource');

const ADDRESS = '1Legacy';
const locals = { network: { blockchain: 'bitcoin', environment: 'mainnet' } };
const SCRIPT = '76a914aa88ac';

describe('bitcoin-utxo-service', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns the mined set with the address script, in the shape the resource reads', async () => {
    esplora.get.mockImplementation(async (path) =>
      path.endsWith('/utxo')
        ? [
            { txid: 't1', vout: 0, value: 1000, status: { confirmed: true } },
            { txid: 't2', vout: 3, value: 2500, status: { confirmed: true } },
            { txid: 'm', vout: 0, value: 9, status: { confirmed: false } },
          ]
        : [
            {
              vin: [],
              vout: [{ scriptpubkey_address: ADDRESS, scriptpubkey: SCRIPT }],
            },
          ]
    );

    const out = await service.getUtxo(ADDRESS, {}, locals);

    expect(out.meta).toEqual({ nextPageToken: null });
    expect(await Promise.all(out.data.map((u) => decorateUtxo(u)))).toEqual([
      {
        address: ADDRESS,
        txId: 't1',
        txid: 't1',
        outputIndex: 0,
        vout: 0,
        script: SCRIPT,
        satoshis: 1000,
      },
      {
        address: ADDRESS,
        txId: 't2',
        txid: 't2',
        outputIndex: 3,
        vout: 3,
        script: SCRIPT,
        satoshis: 2500,
      },
    ]);
  });

  it('finds the script on an input when the address only spent', async () => {
    esplora.get.mockImplementation(async (path) =>
      path.endsWith('/utxo')
        ? [{ txid: 't1', vout: 0, value: 1, status: { confirmed: true } }]
        : [
            {
              vin: [{ prevout: { scriptpubkey_address: ADDRESS, scriptpubkey: SCRIPT } }],
              vout: [{ scriptpubkey_address: 'other', scriptpubkey: '00' }],
            },
          ]
    );

    const { data } = await service.getUtxo(ADDRESS, {}, locals);

    expect(data[0].mined.meta.script).toBe(SCRIPT);
  });

  it('skips the history read when there is nothing to spend', async () => {
    esplora.get.mockResolvedValue([]);

    expect(await service.getUtxo(ADDRESS, {}, locals)).toEqual({
      data: [],
      meta: { nextPageToken: null },
    });
    expect(esplora.get).toHaveBeenCalledTimes(1);
  });

  it('answers 422 utxo_set_too_large when the host refuses to enumerate the set', async () => {
    esplora.get.mockRejectedValue(
      Object.assign(new Error('400'), { response: { status: 400, data: 'Too many unspent' } })
    );

    await expect(service.getUtxo(ADDRESS, {}, locals)).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'utxo_set_too_large',
    });
  });

  it('lets an upstream outage through unchanged', async () => {
    const down = Object.assign(new Error('down'), { response: { status: 503 } });
    esplora.get.mockRejectedValue(down);

    await expect(service.getUtxo(ADDRESS, {}, locals)).rejects.toBe(down);
  });
});
