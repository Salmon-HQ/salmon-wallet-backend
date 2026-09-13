'use strict';

jest.mock('../../../../shared/coingecko-service', () => ({ getTokenPrices: jest.fn() }));

const { SystemProgram } = require('@solana/web3.js');
const coingecko = require('../../../../shared/coingecko-service');
const { SOL_ADDRESS } = require('../../../../../constants/solana-constants');
const transferSol = require('../transfer-sol');

const SENDER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const RECIPIENT = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
const locals = { network: { id: 'solana-mainnet' } };

describe('transfer-sol adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    coingecko.getTokenPrices.mockResolvedValue(new Map([[SOL_ADDRESS, { usdPrice: 200 }]]));
  });

  it('validates recipient and amount before anything else runs', () => {
    expect(transferSol.validate({ publicKey: SENDER })).toMatchObject({
      error: 'missing_parameter',
    });
    expect(
      transferSol.validate({ publicKey: SENDER, recipient: 'zzz', uiAmount: '1' })
    ).toMatchObject({
      error: 'invalid_parameter',
    });
    expect(
      transferSol.validate({ publicKey: SENDER, recipient: SENDER, uiAmount: '1' })
    ).toMatchObject({ error: 'invalid_parameter' });
    expect(transferSol.validate({ publicKey: SENDER, recipient: RECIPIENT })).toMatchObject({
      error: 'missing_parameter',
    });
    expect(
      transferSol.validate({ publicKey: SENDER, recipient: RECIPIENT, uiAmount: '-1' })
    ).toMatchObject({ error: 'invalid_parameter' });
    expect(
      transferSol.validate({ publicKey: SENDER, recipient: RECIPIENT, uiAmount: '0.0000001' })
    ).toMatchObject({ error: 'amount_too_small' });
    expect(
      transferSol.validate({ publicKey: SENDER, recipient: RECIPIENT, uiAmount: '0.25' })
    ).toEqual({ params: { recipient: RECIPIENT, lamports: 250000000, publicKey: SENDER } });
  });

  it('builds one System transfer with the amount and its USD value', async () => {
    const result = await transferSol.build(
      { recipient: RECIPIENT, lamports: 250000000, publicKey: SENDER },
      { locals }
    );

    expect(result.instructions).toHaveLength(1);
    expect(result.instructions[0].programId.toBase58()).toBe(SystemProgram.programId.toBase58());
    expect(coingecko.getTokenPrices).toHaveBeenCalledWith([SOL_ADDRESS], locals);
    expect(result.display).toEqual({
      recipient: RECIPIENT,
      amount: '250000000',
      mint: SOL_ADDRESS,
      decimals: 9,
      symbol: 'SOL',
      usdValue: 50,
    });
  });

  it('renders without a USD value when the price is unavailable, never zero', async () => {
    coingecko.getTokenPrices.mockRejectedValue(new Error('upstream down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await transferSol.build(
      { recipient: RECIPIENT, lamports: 250000000, publicKey: SENDER },
      { locals }
    );

    expect(result.display.usdValue).toBeNull();
    warn.mockRestore();
  });
});
