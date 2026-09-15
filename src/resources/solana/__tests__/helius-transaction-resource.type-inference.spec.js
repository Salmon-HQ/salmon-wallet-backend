'use strict';

/**
 * Unit tests for the small helpers extracted out of mapTransactionType:
 *   - inferDirectionalType (sender/receiver flags → SEND / RECEIVE / INTERACTION)
 *   - mapTransactionType (top-level mapping covering TRANSFER, UNKNOWN, and
 *                         Helius-typed flows)
 */

const { __testing } = require('../helius-transaction-resource');
const { inferDirectionalType, mapTransactionType } = __testing;
const { SEND, RECEIVE, INTERACTION, UNKNOWN } = require('../../../constants/transaction-types');

const USER = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';

describe('inferDirectionalType', () => {
  test('receiver only → RECEIVE', () => {
    expect(inferDirectionalType(false, true)).toBe(RECEIVE);
  });
  test('sender only → SEND', () => {
    expect(inferDirectionalType(true, false)).toBe(SEND);
  });
  test('both → INTERACTION', () => {
    expect(inferDirectionalType(true, true)).toBe(INTERACTION);
  });
  test('neither → undefined', () => {
    expect(inferDirectionalType(false, false)).toBeUndefined();
  });
});

describe('mapTransactionType', () => {
  const buildTx = (overrides = {}) => ({
    instructions: [],
    nativeTransfers: [],
    tokenTransfers: [],
    ...overrides,
  });

  test("the parser's token-program sources surface under the provider-neutral SOLANA_PROGRAM_LIBRARY label", async () => {
    const transformTransaction = require('../helius-transaction-resource');
    const base = {
      signature: 'sig',
      timestamp: 1,
      type: 'TRANSFER',
      feePayer: 'user',
      instructions: [],
      tokenTransfers: [],
      nativeTransfers: [],
    };
    for (const source of ['TOKEN_PROGRAM', 'TOKEN_2022_PROGRAM', 'ASSOCIATED_TOKEN_PROGRAM']) {
      const item = await transformTransaction({ ...base, source }, 'user', []);
      expect(item.source).toBe('SOLANA_PROGRAM_LIBRARY');
    }
    const item = await transformTransaction({ ...base, source: 'RAYDIUM' }, 'user', []);
    expect(item.source).toBe('RAYDIUM');
  });

  test('TRANSFER with sender-only → SEND', () => {
    const result = mapTransactionType(
      'TRANSFER',
      USER,
      buildTx({
        nativeTransfers: [{ fromUserAccount: USER, toUserAccount: 'other' }],
      })
    );
    expect(result).toBe(SEND);
  });

  test('TRANSFER with receiver-only → RECEIVE', () => {
    const result = mapTransactionType(
      'TRANSFER',
      USER,
      buildTx({
        nativeTransfers: [{ fromUserAccount: 'other', toUserAccount: USER }],
      })
    );
    expect(result).toBe(RECEIVE);
  });

  test('TRANSFER with self-loop → SEND fallback', () => {
    const result = mapTransactionType(
      'TRANSFER',
      USER,
      buildTx({
        nativeTransfers: [{ fromUserAccount: USER, toUserAccount: USER }],
      })
    );
    expect(result).toBe(SEND);
  });

  test('UNKNOWN type with token transfer touching user → directional', () => {
    expect(
      mapTransactionType(
        'UNKNOWN',
        USER,
        buildTx({
          tokenTransfers: [{ fromUserAccount: 'other', toUserAccount: USER, mint: 'A' }],
        })
      )
    ).toBe(RECEIVE);
  });

  test('UNKNOWN type with no transfers → UNKNOWN', () => {
    expect(mapTransactionType('UNKNOWN', USER, buildTx())).toBe(UNKNOWN);
  });

  test('Helius mapped type passes through (e.g. STAKE)', () => {
    expect(mapTransactionType('STAKE_TOKEN', USER, buildTx())).not.toBe(UNKNOWN);
  });
});
