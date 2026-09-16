'use strict';

/**
 * Direction is read off the wallet's balance change, never off the
 * provider's transfer lists (spec 016). The provider's type only picks the
 * semantic buckets.
 */
const transformTransaction = require('../helius-transaction-resource');
const { __testing } = require('../helius-transaction-resource');
const {
  SEND,
  RECEIVE,
  INTERACTION,
  UNKNOWN,
  STAKE,
  MEMO,
} = require('../../../constants/transaction-types');
const { SOL_ADDRESS } = require('../../../constants/solana-constants');

const { mapProviderType, resolveType, NATIVE_SIDE_LEG_MIN_LAMPORTS } = __testing;
const WALLET = 'user-wallet';
const OTHER = 'other-wallet';
const MINT = 'mint-a';

const solLeg = { contract: SOL_ADDRESS };
const tokenLeg = { contract: MINT };

describe('mapProviderType', () => {
  test('keeps TRANSFER as a transfer for the legs to direct', () => {
    expect(mapProviderType('TRANSFER')).toBe('TRANSFER');
    expect(mapProviderType('COMPRESSED_NFT_TRANSFER')).toBe('TRANSFER');
  });
  test('names the semantic buckets, and calls the rest an interaction', () => {
    expect(mapProviderType('STAKE_TOKEN')).toBe(STAKE);
    expect(mapProviderType('UNKNOWN')).toBe(UNKNOWN);
    expect(mapProviderType('SWAP')).toBe(INTERACTION);
    expect(mapProviderType('SOMETHING_NEW')).toBe(INTERACTION);
  });
});

describe('resolveType', () => {
  const tx = (feePayer) => ({ feePayer });
  test('outputs only → send; inputs only → receive; both → interaction', () => {
    expect(
      resolveType('TRANSFER', tx(WALLET), WALLET, { inputs: [], outputs: [tokenLeg] }, null)
    ).toBe(SEND);
    expect(
      resolveType('TRANSFER', tx(OTHER), WALLET, { inputs: [tokenLeg], outputs: [] }, null)
    ).toBe(RECEIVE);
    expect(
      resolveType('TRANSFER', tx(WALLET), WALLET, { inputs: [solLeg], outputs: [tokenLeg] }, null)
    ).toBe(INTERACTION);
  });
  test('SOL that only came back to the wallet that signed is an interaction, not a receive', () => {
    expect(
      resolveType('TRANSFER', tx(WALLET), WALLET, { inputs: [solLeg], outputs: [] }, null)
    ).toBe(INTERACTION);
    expect(
      resolveType('TRANSFER', tx(OTHER), WALLET, { inputs: [solLeg], outputs: [] }, null)
    ).toBe(RECEIVE);
  });
  test('nothing moved: the note, else an interaction the wallet signed, else unknown', () => {
    const none = { inputs: [], outputs: [] };
    expect(resolveType(UNKNOWN, tx(WALLET), WALLET, none, 'gm')).toBe(MEMO);
    expect(resolveType(UNKNOWN, tx(WALLET), WALLET, none, null)).toBe(INTERACTION);
    expect(resolveType(UNKNOWN, tx(OTHER), WALLET, none, null)).toBe(UNKNOWN);
  });
  test('a semantic provider type keeps precedence over the legs', () => {
    expect(resolveType(STAKE, tx(WALLET), WALLET, { inputs: [], outputs: [tokenLeg] }, null)).toBe(
      STAKE
    );
  });
});

describe('transformTransaction, end to end on hand-rolled ledgers', () => {
  const ledger = (rows) => ({
    signature: 'sig',
    type: 'TRANSFER',
    timestamp: 1,
    fee: 5000,
    feePayer: WALLET,
    nativeTransfers: [],
    tokenTransfers: [],
    accountData: rows,
  });
  const change = (userAccount, mint, tokenAmount, decimals = 6) => ({
    userAccount,
    tokenAccount: `${userAccount}-${mint}`,
    mint,
    rawTokenAmount: { tokenAmount, decimals },
  });

  test('a token that hopped between two of the wallet’s accounts leaves no leg and reads as an interaction', async () => {
    const tx = ledger([
      { account: WALLET, nativeBalanceChange: -5000, tokenBalanceChanges: [] },
      {
        account: 'a',
        nativeBalanceChange: 0,
        tokenBalanceChanges: [change(WALLET, MINT, '-1', 0)],
      },
      { account: 'b', nativeBalanceChange: 0, tokenBalanceChanges: [change(WALLET, MINT, '1', 0)] },
    ]);
    tx.tokenTransfers = [
      {
        fromUserAccount: WALLET,
        toUserAccount: WALLET,
        mint: MINT,
        tokenAmount: '1',
        decimals: 0,
        tokenStandard: 'NonFungible',
      },
    ];
    const result = await transformTransaction(tx, WALLET);
    expect(result.type).toBe(INTERACTION);
    expect(result.inputs).toEqual([]);
    expect(result.outputs).toEqual([]);
  });

  test("the parser's token-program sources surface under the provider-neutral SOLANA_PROGRAM_LIBRARY label", async () => {
    const tx = { ...ledger([]), source: 'TOKEN_PROGRAM' };
    const result = await transformTransaction(tx, WALLET);
    expect(result.source).toBe('SOLANA_PROGRAM_LIBRARY');
  });

  test('a SOL leg beside a token leg folds under the side-leg floor, and shows above it', async () => {
    const below = ledger([
      { account: WALLET, nativeBalanceChange: -5000 - 2039280, tokenBalanceChanges: [] },
      {
        account: 'ata',
        nativeBalanceChange: 0,
        tokenBalanceChanges: [change(WALLET, MINT, '-1000000')],
      },
    ]);
    const folded = await transformTransaction(below, WALLET);
    expect(folded.type).toBe(SEND);
    expect(folded.outputs.map((leg) => leg.contract)).toEqual([MINT]);

    const above = ledger([
      {
        account: WALLET,
        nativeBalanceChange: -5000 - Number(NATIVE_SIDE_LEG_MIN_LAMPORTS),
        tokenBalanceChanges: [],
      },
      {
        account: 'ata',
        nativeBalanceChange: 0,
        tokenBalanceChanges: [change(WALLET, MINT, '-1000000')],
      },
    ]);
    const shown = await transformTransaction(above, WALLET);
    expect(shown.outputs.map((leg) => leg.contract).sort()).toEqual([MINT, SOL_ADDRESS].sort());
  });

  test('a SOL leg that is the only asset moving is always reported, however small', async () => {
    const tx = ledger([
      { account: WALLET, nativeBalanceChange: -5000 - 1, tokenBalanceChanges: [] },
    ]);
    tx.nativeTransfers = [{ fromUserAccount: WALLET, toUserAccount: OTHER, amount: 1 }];
    const result = await transformTransaction(tx, WALLET);
    expect(result.type).toBe(SEND);
    expect(result.outputs).toEqual([
      expect.objectContaining({ contract: SOL_ADDRESS, amount: '1', destination: OTHER }),
    ]);
  });

  test('the counterparty is the one that received the most of that asset', async () => {
    const tx = ledger([
      { account: WALLET, nativeBalanceChange: -5000, tokenBalanceChanges: [] },
      {
        account: 'ata',
        nativeBalanceChange: 0,
        tokenBalanceChanges: [change(WALLET, MINT, '-300')],
      },
    ]);
    tx.tokenTransfers = [
      {
        fromUserAccount: WALLET,
        toUserAccount: 'fee-taker',
        mint: MINT,
        tokenAmount: '100',
        decimals: 6,
      },
      {
        fromUserAccount: WALLET,
        toUserAccount: OTHER,
        mint: MINT,
        tokenAmount: '200',
        decimals: 6,
      },
    ];
    const result = await transformTransaction(tx, WALLET);
    expect(result.outputs[0].destination).toBe(OTHER);
  });

  test('without a ledger the transfers decide, incoming minus outgoing', async () => {
    const tx = ledger(undefined);
    delete tx.accountData;
    tx.tokenTransfers = [
      { fromUserAccount: OTHER, toUserAccount: WALLET, mint: MINT, tokenAmount: '5', decimals: 0 },
    ];
    const result = await transformTransaction(tx, WALLET);
    expect(result.type).toBe(RECEIVE);
    expect(result.inputs[0]).toMatchObject({ contract: MINT, amount: '5', source: OTHER });
  });
});
