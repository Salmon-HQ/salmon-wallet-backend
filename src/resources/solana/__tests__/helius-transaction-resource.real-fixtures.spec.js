'use strict';

/**
 * The seven transactions spec 016 was written against, as Helius parsed
 * them (trimmed to the fields the mapper reads). The wallet is the owner's;
 * the numbers are the ledger's. Each test says what the wallet actually did.
 */
const fixtures = require('./fixtures/helius-real-transactions.json');
const transformTransaction = require('../helius-transaction-resource');
const { SEND, RECEIVE, INTERACTION } = require('../../../constants/transaction-types');
const { SOL_ADDRESS } = require('../../../constants/solana-constants');

const WALLET = '7Q3Hm2QkDLJyy727sNc2AeH2vZxiPgWWXX6vTq8Ras6n';
const FRIEND = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MNDFLK = 'CNM8WMZvQ15baEV1r4QEW1MPR3xwaotattgtA4abnDmV';

const run = (name) => transformTransaction(fixtures[name], WALLET);
const legOf = (legs, contract) => legs.find((leg) => leg.contract === contract);

describe('the real transactions of spec 016', () => {
  test('a cleanup that moved the pNFT between two of the wallet’s own accounts and returned rent: one SOL input, no NFT, an interaction', async () => {
    const tx = await run('cleanup-pnft-self-transfer');
    expect(tx.type).toBe(INTERACTION);
    expect(tx.outputs).toEqual([]);
    expect(tx.inputs).toHaveLength(1);
    // Six closed accounts' rent came back, minus the service's fees; the
    // transaction fee is on its own field.
    expect(legOf(tx.inputs, SOL_ADDRESS).amount).toBe('3622163');
    expect(legOf(tx.inputs, MNDFLK)).toBeUndefined();
    expect(tx.fee).toEqual({ amount: 24895, decimals: 9, symbol: 'SOL' });
  });

  test('five accounts closed: the rent is one SOL input, not five fee outputs to the vault', async () => {
    const tx = await run('cleanup-rent-reclaimed');
    expect(tx.type).toBe(INTERACTION);
    expect(tx.outputs).toEqual([]);
    expect(tx.inputs).toHaveLength(1);
    expect(tx.inputs[0].amount).toBe('9992475');
    expect(tx.inputs[0].source).toBeUndefined();
  });

  test('two accounts closed: the same shape at a smaller size', async () => {
    const tx = await run('cleanup-two-accounts');
    expect(tx.type).toBe(INTERACTION);
    expect(tx.inputs.map((leg) => leg.contract)).toEqual([SOL_ADDRESS]);
    expect(tx.outputs).toEqual([]);
  });

  test('a USDC send reads as it always did: one output to the friend, no SOL leg for the fee', async () => {
    const tx = await run('usdc-send-with-memo');
    expect(tx.type).toBe(SEND);
    expect(tx.inputs).toEqual([]);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0]).toMatchObject({ contract: USDC, amount: '1100000', destination: FRIEND });
    expect(tx.memo).toBe('pr_HR4Hmoj3Tmrc');
  });

  test('an NFT sent with a royalty on the side: the NFT output only, the royalty folds', async () => {
    const tx = await run('nft-send-with-royalty');
    expect(tx.type).toBe(SEND);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0]).toMatchObject({
      contract: MNDFLK,
      amount: '1',
      isNft: true,
      destination: FRIEND,
    });
    expect(tx.inputs).toEqual([]);
  });

  test('an NFT received from the friend', async () => {
    const tx = await run('nft-receive');
    expect(tx.type).toBe(RECEIVE);
    expect(tx.inputs).toHaveLength(1);
    expect(tx.inputs[0]).toMatchObject({
      contract: MNDFLK,
      amount: '1',
      isNft: true,
      source: FRIEND,
    });
    expect(tx.outputs).toEqual([]);
    expect(tx.fee).toBeUndefined();
  });

  test('a swap shows what left and what arrived, as one interaction', async () => {
    const tx = await run('aggregator-swap');
    expect(tx.type).toBe(INTERACTION);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0]).toMatchObject({ contract: USDC, amount: '1241534' });
    expect(tx.outputs[0].destination).toBeUndefined();
    expect(tx.inputs).toHaveLength(1);
    expect(tx.inputs[0].amount).toBe('2052479');
  });
});
