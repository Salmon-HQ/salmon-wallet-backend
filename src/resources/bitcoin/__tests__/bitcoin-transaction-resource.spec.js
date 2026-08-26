'use strict';

const decorateTransaction = require('../bitcoin-transaction-resource');

describe('bitcoin-transaction-resource', () => {
  const baseTransaction = (events) => ({
    blockchain: 'bitcoin',
    address: 'btc-source',
    id: 'tx-1',
    date: '2026-04-23T00:00:00.000Z',
    status: 'completed',
    events,
  });

  it('decorates bitcoin sends without ethereum-only token lookups', async () => {
    const transaction = baseTransaction([
      {
        type: 'utxo_input',
        source: 'btc-source',
        destination: 'btc-network',
        denomination: 'BTC',
        amount: '1',
        decimals: 8,
      },
      {
        type: 'utxo_output',
        source: 'btc-network',
        destination: 'btc-destination',
        denomination: 'BTC',
        amount: '0.9',
        decimals: 8,
      },
      {
        type: 'fee',
        source: 'btc-source',
        denomination: 'BTC',
        amount: '0.1',
        decimals: 8,
      },
    ]);

    const result = await decorateTransaction(transaction, {}, undefined, { locals: {} });

    expect(result).toEqual({
      id: 'tx-1',
      timestamp: '2026-04-23T00:00:00.000Z',
      status: 'completed',
      type: 'send',
      fee: undefined,
      inputs: [],
      outputs: [
        {
          amount: '1',
          decimals: 8,
          symbol: 'BTC',
          name: 'Bitcoin',
          logo: expect.any(String),
          contract: undefined,
          source: 'btc-source',
          destination: 'btc-network',
        },
      ],
    });
  });

  it('decorates bitcoin receives', async () => {
    const transaction = baseTransaction([
      {
        type: 'utxo_input',
        source: 'btc-network',
        destination: 'btc-miner',
        denomination: 'BTC',
        amount: '0.5',
        decimals: 8,
      },
      {
        type: 'utxo_output',
        source: 'btc-network',
        destination: 'btc-source',
        denomination: 'BTC',
        amount: '0.5',
        decimals: 8,
      },
    ]);

    const result = await decorateTransaction(transaction, {}, undefined, { locals: {} });

    expect(result.type).toBe('receive');
    expect(result.inputs).toEqual([
      {
        amount: '0.5',
        decimals: 8,
        symbol: 'BTC',
        name: 'Bitcoin',
        logo: expect.any(String),
        contract: undefined,
        source: 'btc-network',
        destination: 'btc-source',
      },
    ]);
  });

  it('includes bitcoin fees when the transaction has a change output', async () => {
    const transaction = baseTransaction([
      {
        type: 'utxo_input',
        source: 'btc-source',
        destination: 'btc-network',
        denomination: 'BTC',
        amount: '1',
        decimals: 8,
      },
      {
        type: 'utxo_output',
        source: 'btc-network',
        destination: 'btc-source',
        denomination: 'BTC',
        amount: '0.4',
        decimals: 8,
      },
      {
        type: 'fee',
        source: 'btc-source',
        denomination: 'BTC',
        amount: '0.1',
        decimals: 8,
      },
    ]);

    const result = await decorateTransaction(transaction, {}, undefined, { locals: {} });

    expect(result.type).toBe('swap');
    expect(result.fee).toEqual({
      amount: '0.1',
      decimals: 8,
      symbol: 'BTC',
    });
  });

  it('returns unknown for transactions without wallet-side movement', async () => {
    const transaction = baseTransaction([
      {
        type: 'utxo_input',
        source: 'other-source',
        destination: 'btc-network',
        denomination: 'BTC',
        amount: '1',
        decimals: 8,
      },
      {
        type: 'utxo_output',
        source: 'btc-network',
        destination: 'other-destination',
        denomination: 'BTC',
        amount: '0.9',
        decimals: 8,
      },
    ]);

    const result = await decorateTransaction(transaction, {}, undefined, { locals: {} });

    expect(result.type).toBe('unknown');
    expect(result.inputs).toEqual([]);
    expect(result.outputs).toEqual([]);
  });
});
