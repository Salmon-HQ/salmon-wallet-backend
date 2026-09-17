'use strict';

const fixtures = require('./fixtures/helius-real-transactions.json');
const transformTransaction = require('../helius-transaction-resource');
const { deriveAction } = require('../transaction-action');
const { INTERACTION, SEND } = require('../../../constants/transaction-types');
const { SOL_ADDRESS } = require('../../../constants/solana-constants');

const WALLET = '7Q3Hm2QkDLJyy727sNc2AeH2vZxiPgWWXX6vTq8Ras6n';
const sol = { contract: SOL_ADDRESS };
const usdc = { contract: 'EPjF' };
const nft = { contract: 'NFT1', isNft: true };

describe('deriveAction', () => {
  test('names the app for the detail whatever the type, and nothing else outside an interaction', () => {
    expect(deriveAction({}, WALLET, { inputs: [], outputs: [usdc] }, SEND, 'AGGREGATOR')).toEqual({
      app: 'Jupiter',
    });
    expect(
      deriveAction({}, WALLET, { inputs: [], outputs: [usdc] }, SEND, 'SOLANA_PROGRAM_LIBRARY')
    ).toEqual({});
  });
  test('two assets on opposite sides is a swap', () => {
    expect(
      deriveAction({}, WALLET, { inputs: [sol], outputs: [usdc] }, INTERACTION, 'AGGREGATOR')
    ).toEqual({ app: 'Jupiter', action: 'swap' });
  });
  test('an NFT out and SOL in is a sale; the other way a purchase', () => {
    expect(
      deriveAction({}, WALLET, { inputs: [sol], outputs: [nft] }, INTERACTION, 'MAGIC_EDEN').action
    ).toBe('nft_sale');
    expect(
      deriveAction({}, WALLET, { inputs: [nft], outputs: [sol] }, INTERACTION, 'TENSOR').action
    ).toBe('nft_purchase');
  });
  test('SOL back with closed accounts on the ledger is accounts_closed, counted', () => {
    const tx = {
      accountData: [
        { account: WALLET, nativeBalanceChange: 4000000, tokenBalanceChanges: [] },
        { account: 'ata-1', nativeBalanceChange: -2039280, tokenBalanceChanges: [] },
        { account: 'ata-2', nativeBalanceChange: -2039280, tokenBalanceChanges: [] },
        { account: 'vault', nativeBalanceChange: 78560, tokenBalanceChanges: [] },
      ],
    };
    expect(
      deriveAction(tx, WALLET, { inputs: [sol], outputs: [] }, INTERACTION, undefined)
    ).toEqual({
      action: 'accounts_closed',
      actionMeta: { count: 2 },
    });
  });
  test('anything else the wallet signed is a program call', () => {
    expect(
      deriveAction(
        { accountData: [] },
        WALLET,
        { inputs: [], outputs: [] },
        INTERACTION,
        'SQUADS_V4'
      )
    ).toEqual({ app: 'Squads', action: 'program_call' });
  });
});

describe('on the real transactions', () => {
  test('the three cleanups are accounts_closed with their counts', async () => {
    const counts = await Promise.all(
      ['cleanup-pnft-self-transfer', 'cleanup-rent-reclaimed', 'cleanup-two-accounts'].map(
        async (name) => {
          const tx = await transformTransaction(fixtures[name], WALLET);
          expect(tx.action).toBe('accounts_closed');
          return tx.actionMeta.count;
        }
      )
    );
    expect(counts).toEqual([6, 5, 2]);
  });
  test('the aggregator swap is a swap by Jupiter', async () => {
    const tx = await transformTransaction(fixtures['aggregator-swap'], WALLET);
    expect(tx.action).toBe('swap');
    expect(tx.app).toBe('Jupiter');
  });
  test('a plain send carries no action', async () => {
    const tx = await transformTransaction(fixtures['usdc-send-with-memo'], WALLET);
    expect(tx.action).toBeUndefined();
    expect(tx.app).toBeUndefined();
  });
});
