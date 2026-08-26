'use strict';

const decorateUtxo = require('../bitcoin-utxo-resource');

const decorate = (utxo) => decorateUtxo(utxo, {}, undefined, { locals: {} });

const MINED_UTXO = {
  mined: {
    tx_id: 'tx-1',
    index: 2,
    meta: {
      addresses: ['btc-address'],
      script: 'script-hex',
    },
  },
  value: 12345,
};

describe('bitcoin-utxo-resource', () => {
  it('decorates Blockdaemon UTXO payloads to the public Bitcoin shape', async () => {
    await expect(decorate(MINED_UTXO)).resolves.toEqual({
      address: 'btc-address',
      txId: 'tx-1',
      txid: 'tx-1',
      outputIndex: 2,
      vout: 2,
      script: 'script-hex',
      satoshis: 12345,
    });
  });

  it('emits the names the wallet PSBT builder reads, without dropping the shipped ones', async () => {
    const result = await decorate(MINED_UTXO);

    // `txid`/`vout` are what bitcoinjs-lib expects; `txId`/`outputIndex` are
    // the shape already shipped, so both travel.
    expect(result.txid).toBe(result.txId);
    expect(result.vout).toBe(result.outputIndex);
  });

  it.each([
    ['no transaction id', { ...MINED_UTXO, mined: { ...MINED_UTXO.mined, tx_id: undefined } }],
    ['no output index', { ...MINED_UTXO, mined: { ...MINED_UTXO.mined, index: undefined } }],
    ['no mined block at all', { value: 12345 }],
  ])('drops a record with %s instead of emitting undefined fields', async (_label, utxo) => {
    // This list feeds transaction construction: an output without an id or an
    // index cannot be spent, and passing it through only moves the failure
    // somewhere with less context.
    await expect(decorate(utxo)).resolves.toBeNull();
  });

  it('keeps a zero output index, which is a valid vout', async () => {
    const result = await decorate({ ...MINED_UTXO, mined: { ...MINED_UTXO.mined, index: 0 } });

    expect(result.vout).toBe(0);
  });
});
