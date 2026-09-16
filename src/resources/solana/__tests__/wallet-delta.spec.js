'use strict';

const { computeWalletDelta } = require('../wallet-delta');
const { __testing } = require('../helius-transaction-resource');

const { toRawAmount } = __testing;
const WALLET = 'WaLLet111111111111111111111111111111111111';
const OTHER = 'OtHeR1111111111111111111111111111111111111';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const deps = { toRawAmount };

const tokenChange = (userAccount, mint, tokenAmount, decimals = 6) => ({
  userAccount,
  tokenAccount: `${userAccount.slice(0, 4)}-ata-${mint.slice(0, 4)}`,
  mint,
  rawTokenAmount: { tokenAmount, decimals },
});

describe('computeWalletDelta', () => {
  test('reads lamports off the wallet row and puts the fee back when the wallet paid it', () => {
    const delta = computeWalletDelta(
      {
        feePayer: WALLET,
        fee: 5000,
        accountData: [
          { account: WALLET, nativeBalanceChange: -5000, tokenBalanceChanges: [] },
          { account: OTHER, nativeBalanceChange: 100, tokenBalanceChanges: [] },
        ],
      },
      WALLET,
      deps
    );
    expect(delta).toEqual({ native: '0', tokens: new Map(), source: 'accountData' });
  });

  test('leaves the fee out of the sum when somebody else paid it', () => {
    const delta = computeWalletDelta(
      {
        feePayer: OTHER,
        fee: 5000,
        accountData: [{ account: WALLET, nativeBalanceChange: 2039280, tokenBalanceChanges: [] }],
      },
      WALLET,
      deps
    );
    expect(delta.native).toBe('2039280');
  });

  test('sums a mint across every token account the wallet owns, and ignores other owners', () => {
    const delta = computeWalletDelta(
      {
        feePayer: OTHER,
        accountData: [
          {
            account: 'ata-1',
            nativeBalanceChange: 0,
            tokenBalanceChanges: [tokenChange(WALLET, USDC, '-1000000')],
          },
          {
            account: 'ata-2',
            nativeBalanceChange: 0,
            tokenBalanceChanges: [tokenChange(WALLET, USDC, '250000')],
          },
          {
            account: 'ata-3',
            nativeBalanceChange: 0,
            tokenBalanceChanges: [tokenChange(OTHER, USDC, '750000')],
          },
        ],
      },
      WALLET,
      deps
    );
    expect(delta.tokens.get(USDC)).toEqual({ amount: '-750000', decimals: 6 });
    expect(delta.tokens.size).toBe(1);
  });

  test('drops a mint whose net is zero — a hop between two accounts of the same owner', () => {
    const delta = computeWalletDelta(
      {
        feePayer: WALLET,
        fee: 1,
        accountData: [
          { account: WALLET, nativeBalanceChange: -1, tokenBalanceChanges: [] },
          {
            account: 'ata-old',
            nativeBalanceChange: 0,
            tokenBalanceChanges: [tokenChange(WALLET, 'NFT', '-1', 0)],
          },
          {
            account: 'ata-new',
            nativeBalanceChange: 0,
            tokenBalanceChanges: [tokenChange(WALLET, 'NFT', '1', 0)],
          },
        ],
      },
      WALLET,
      deps
    );
    expect(delta.tokens.size).toBe(0);
    expect(delta.native).toBe('0');
  });

  test('falls back to the transfers, incoming minus outgoing, when there is no ledger', () => {
    const delta = computeWalletDelta(
      {
        feePayer: WALLET,
        fee: 5000,
        nativeTransfers: [
          { fromUserAccount: WALLET, toUserAccount: OTHER, amount: 700 },
          { fromUserAccount: OTHER, toUserAccount: WALLET, amount: 200 },
        ],
        tokenTransfers: [
          {
            fromUserAccount: OTHER,
            toUserAccount: WALLET,
            mint: USDC,
            tokenAmount: 1.5,
            decimals: 6,
          },
          {
            fromUserAccount: WALLET,
            toUserAccount: OTHER,
            mint: USDC,
            tokenAmount: '250000',
            decimals: 6,
          },
        ],
      },
      WALLET,
      deps
    );
    expect(delta.source).toBe('transfers');
    expect(delta.native).toBe('-500');
    expect(delta.tokens.get(USDC)).toEqual({ amount: '1250000', decimals: 6 });
  });

  test('never rounds a large raw balance', () => {
    const big = '123456789012345678901234567890';
    const delta = computeWalletDelta(
      {
        feePayer: OTHER,
        accountData: [
          {
            account: 'ata',
            nativeBalanceChange: 0,
            tokenBalanceChanges: [tokenChange(WALLET, 'BIG', big, 9)],
          },
        ],
      },
      WALLET,
      deps
    );
    expect(delta.tokens.get('BIG').amount).toBe(big);
  });
});
