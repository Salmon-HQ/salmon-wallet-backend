'use strict';

/**
 * Unit tests for the small helpers extracted out of mapTransactionType:
 *   - inferDirectionalType (sender/receiver flags → SEND / RECEIVE / INTERACTION)
 *   - collectMintSets (sets of mints touched by the user, with SOL_ADDRESS
 *                      normalization)
 *   - hasMintAsymmetry (different in/out mint sets ⇒ swap-by-mix)
 *   - inferSwapByMintMix (full swap-by-mint-mix heuristic)
 *   - mapTransactionType (top-level mapping covering Jupiter, TRANSFER,
 *                         UNKNOWN, and Helius-typed flows)
 */

const { __testing } = require('../helius-transaction-resource');
const {
  inferDirectionalType,
  collectMintSets,
  hasMintAsymmetry,
  inferSwapByMintMix,
  mapTransactionType,
} = __testing;
const {
  SEND,
  RECEIVE,
  SWAP,
  INTERACTION,
  UNKNOWN,
} = require('../../../constants/transaction-types');
const { SOL_ADDRESS } = require('../../../constants/solana-constants');

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

describe('collectMintSets', () => {
  test('collects outgoing token mints when fromUserAccount === user', () => {
    const { outgoing, incoming } = collectMintSets(
      USER,
      [],
      [{ fromUserAccount: USER, toUserAccount: 'other', mint: 'M1' }]
    );
    expect([...outgoing]).toEqual(['M1']);
    expect(incoming.size).toBe(0);
  });

  test('collects incoming token mints when toUserAccount === user', () => {
    const { outgoing, incoming } = collectMintSets(
      USER,
      [],
      [{ fromUserAccount: 'other', toUserAccount: USER, mint: 'M2' }]
    );
    expect([...incoming]).toEqual(['M2']);
    expect(outgoing.size).toBe(0);
  });

  test('normalizes native transfers to SOL_ADDRESS', () => {
    const { outgoing, incoming } = collectMintSets(
      USER,
      [
        { fromUserAccount: USER, toUserAccount: 'other' },
        { fromUserAccount: 'other', toUserAccount: USER },
      ],
      []
    );
    expect([...outgoing]).toEqual([SOL_ADDRESS]);
    expect([...incoming]).toEqual([SOL_ADDRESS]);
  });
});

describe('hasMintAsymmetry', () => {
  test('false when either side empty', () => {
    expect(hasMintAsymmetry(new Set(), new Set(['A']))).toBe(false);
    expect(hasMintAsymmetry(new Set(['A']), new Set())).toBe(false);
  });
  test('false when sides match exactly', () => {
    expect(hasMintAsymmetry(new Set(['A']), new Set(['A']))).toBe(false);
  });
  test('true when outgoing has mint not in incoming', () => {
    expect(hasMintAsymmetry(new Set(['A']), new Set(['B']))).toBe(true);
  });
  test('true on partial overlap', () => {
    expect(hasMintAsymmetry(new Set(['A', 'B']), new Set(['A']))).toBe(true);
  });
});

describe('inferSwapByMintMix', () => {
  test('returns SWAP for token-A-out, token-B-in', () => {
    const result = inferSwapByMintMix(
      USER,
      [],
      [
        { fromUserAccount: USER, toUserAccount: 'pool', mint: 'A' },
        { fromUserAccount: 'pool', toUserAccount: USER, mint: 'B' },
      ]
    );
    expect(result).toBe(SWAP);
  });

  test('returns SWAP for SOL-out, token-in (native + SPL combo)', () => {
    const result = inferSwapByMintMix(
      USER,
      [{ fromUserAccount: USER, toUserAccount: 'pool' }],
      [{ fromUserAccount: 'pool', toUserAccount: USER, mint: 'B' }]
    );
    expect(result).toBe(SWAP);
  });

  test('returns undefined when same mint goes in and out (no asymmetry)', () => {
    const result = inferSwapByMintMix(
      USER,
      [],
      [
        { fromUserAccount: USER, toUserAccount: 'pool', mint: 'A' },
        { fromUserAccount: 'pool', toUserAccount: USER, mint: 'A' },
      ]
    );
    expect(result).toBeUndefined();
  });
});

describe('mapTransactionType', () => {
  const buildTx = (overrides = {}) => ({
    instructions: [],
    nativeTransfers: [],
    tokenTransfers: [],
    ...overrides,
  });

  test('Jupiter program present forces SWAP regardless of Helius type', () => {
    const result = mapTransactionType('TRANSFER', USER, {
      ...buildTx(),
      instructions: [{ programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' }],
    });
    expect(result).toBe(SWAP);
  });

  test('Jupiter LIMIT program also triggers SWAP', () => {
    const result = mapTransactionType('TRANSFER', USER, {
      ...buildTx(),
      instructions: [{ programId: 'j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X' }],
    });
    expect(result).toBe(SWAP);
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

  test('TRANSFER with bidirectional different mints → SWAP', () => {
    const result = mapTransactionType(
      'TRANSFER',
      USER,
      buildTx({
        tokenTransfers: [
          { fromUserAccount: USER, toUserAccount: 'pool', mint: 'A' },
          { fromUserAccount: 'pool', toUserAccount: USER, mint: 'B' },
        ],
      })
    );
    expect(result).toBe(SWAP);
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
