'use strict';

/**
 * Integration tests for hint-set → tx-type derivation across the parser
 * pipeline. Each case feeds a minimal raw RPC tx that exercises a specific
 * source (Marinade, Solend, Sanctum, Drift, etc.) and asserts the orchestrator
 * emits the expected `type` and `source`.
 *
 * Note: this is an in-process unit-style test — we don't reach out to the
 * network. It only verifies the parser registry routes program IDs to the
 * correct hint, then deriveType + pickPrimarySource produce the expected
 * combination.
 */

const { parseTransaction } = require('..');
const { SOURCES } = require('../program-sources');

const SYSTEM = '11111111111111111111111111111111';

const buildTx = ({ programId, parsedType }) => ({
  blockTime: 1700000000,
  slot: 100,
  meta: {
    fee: 5000,
    err: null,
    preTokenBalances: [],
    postTokenBalances: [],
    logMessages: [],
    innerInstructions: [],
  },
  transaction: {
    signatures: ['testSig'],
    message: {
      accountKeys: [{ pubkey: 'feepayer1111111111111111111111111111111111' }],
      instructions: [
        {
          programId,
          parsed: parsedType ? { type: parsedType, info: {} } : null,
        },
      ],
    },
  },
});

describe('Marinade Finance → STAKE_TOKEN', () => {
  test('Marinade program emits STAKE_TOKEN type and MARINADE_FINANCE source', () => {
    const tx = parseTransaction(buildTx({ programId: SOURCES.MARINADE_FINANCE[0] }));
    expect(tx.type).toBe('STAKE_TOKEN');
    expect(tx.source).toBe('MARINADE_FINANCE');
  });
});

describe('Stake Pool / Sanctum → STAKE_TOKEN', () => {
  test('SPL Stake Pool program emits STAKE_TOKEN', () => {
    const tx = parseTransaction(buildTx({ programId: SOURCES.STAKE_POOL[0] }));
    expect(tx.type).toBe('STAKE_TOKEN');
    expect(tx.source).toBe('STAKE_POOL');
  });

  test('Sanctum router emits STAKE_TOKEN with SANCTUM source (aggregator priority wins)', () => {
    const tx = parseTransaction(buildTx({ programId: SOURCES.SANCTUM[0] }));
    expect(tx.type).toBe('STAKE_TOKEN');
    expect(tx.source).toBe('SANCTUM');
  });
});

describe('Lending → OFFER_LOAN', () => {
  test.each([
    ['SOLEND', SOURCES.SOLEND[0]],
    ['KAMINO', SOURCES.KAMINO[0]],
    ['MARGINFI', SOURCES.MARGINFI[0]],
  ])('%s program emits OFFER_LOAN', (sourceName, programId) => {
    const tx = parseTransaction(buildTx({ programId }));
    expect(tx.type).toBe('OFFER_LOAN');
    expect(tx.source).toBe(sourceName);
  });
});

describe('Native Stake program → STAKE_TOKEN / UNSTAKE_TOKEN', () => {
  test('Stake program with `delegate` → STAKE_TOKEN', () => {
    const tx = parseTransaction(
      buildTx({ programId: SOURCES.STAKE_PROGRAM[0], parsedType: 'delegate' })
    );
    expect(tx.type).toBe('STAKE_TOKEN');
  });

  test('Stake program with `deactivate` → UNSTAKE_TOKEN', () => {
    const tx = parseTransaction(
      buildTx({ programId: SOURCES.STAKE_PROGRAM[0], parsedType: 'deactivate' })
    );
    expect(tx.type).toBe('UNSTAKE_TOKEN');
  });
});

describe('Direct DEX → SWAP', () => {
  test.each([
    ['RAYDIUM', SOURCES.RAYDIUM[0]],
    ['ORCA', SOURCES.ORCA[0]],
    ['METEORA', SOURCES.METEORA[0]],
    ['PHOENIX', SOURCES.PHOENIX[0]],
    ['PUMP_AMM', SOURCES.PUMP_AMM[0]],
    ['PHOTON', SOURCES.PHOTON[0]],
    ['MOONSHOT', SOURCES.MOONSHOT[0]],
    ['METEORA_DBC', SOURCES.METEORA_DBC[0]],
    ['MAYAN_FINANCE', SOURCES.MAYAN_FINANCE[0]],
    ['LAUNCHLAB', SOURCES.LAUNCHLAB[0]],
  ])('%s program emits SWAP', (sourceName, programId) => {
    const tx = parseTransaction(buildTx({ programId }));
    expect(tx.type).toBe('SWAP');
    expect(tx.source).toBe(sourceName);
  });
});

describe('Sanctum Infinity → STAKE_TOKEN (LST router)', () => {
  test('Sanctum Infinity program emits STAKE_TOKEN', () => {
    const tx = parseTransaction(buildTx({ programId: SOURCES.SANCTUM_INFINITY[0] }));
    expect(tx.type).toBe('STAKE_TOKEN');
    expect(tx.source).toBe('SANCTUM_INFINITY');
  });
});

describe('Jupiter primary source priority', () => {
  test('Jupiter + Raydium together → JUPITER source wins (aggregator > AMM)', () => {
    const tx = {
      ...buildTx({ programId: SOURCES.JUPITER[0] }),
    };
    tx.transaction.message.instructions = [
      { programId: SOURCES.RAYDIUM[0], parsed: null },
      { programId: SOURCES.JUPITER[0], parsed: null },
    ];
    const result = parseTransaction(tx);
    expect(result.type).toBe('SWAP');
    expect(result.source).toBe('JUPITER');
  });

  test('Jupiter Limit Orders also produce SWAP type', () => {
    const tx = parseTransaction(buildTx({ programId: SOURCES.JUPITER_LIMIT[0] }));
    expect(tx.type).toBe('SWAP');
  });
});

describe('System program transfers → TRANSFER', () => {
  test('System transfer emits TRANSFER when no specific hint set', () => {
    const tx = {
      ...buildTx({ programId: SYSTEM, parsedType: 'transfer' }),
    };
    tx.transaction.message.instructions[0].parsed = {
      type: 'transfer',
      info: { source: 'A', destination: 'B', lamports: 1000 },
    };
    const result = parseTransaction(tx);
    expect(result.type).toBe('TRANSFER');
    expect(result.source).toBe('SYSTEM_PROGRAM');
  });
});

describe('Unknown program → UNKNOWN with no source resolution', () => {
  test('truly unknown program with no transfers emits UNKNOWN', () => {
    const tx = parseTransaction(
      buildTx({ programId: 'TotallyUnknown1111111111111111111111111111' })
    );
    expect(tx.type).toBe('UNKNOWN');
    expect(tx.source).toBeNull();
  });
});
