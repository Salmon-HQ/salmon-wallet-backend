'use strict';

/**
 * Parser helper tests: type derivation, instruction
 * metadata collection, and the real v1 devnet fixture.
 *
 * The orchestrator + per-program parser tests live in `parser.spec.js`.
 */

const { parseTransaction, __testing } = require('..');

describe('deriveType', () => {
  it('returns SWAP when hasJupiter is set', () => {
    const t = __testing.deriveType({
      _hints: { hasJupiter: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('SWAP');
  });

  it('returns SWAP when hasDexSwap is set (direct DEX, no Jupiter)', () => {
    const t = __testing.deriveType({
      _hints: { hasDexSwap: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('SWAP');
  });

  it('returns OFFER_LOAN when hasLoan is set (lending platforms)', () => {
    const t = __testing.deriveType({
      _hints: { hasLoan: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('OFFER_LOAN');
  });

  it('returns STAKE_TOKEN when hasLiquidStake is set', () => {
    const t = __testing.deriveType({
      _hints: { hasLiquidStake: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('STAKE_TOKEN');
  });

  it('returns COMPRESSED_NFT_MINT when hasCnftMint is set', () => {
    const t = __testing.deriveType({
      _hints: { hasCnftMint: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('COMPRESSED_NFT_MINT');
  });

  it('returns TRANSFER when only transfers are present', () => {
    const t = __testing.deriveType({
      _hints: {},
      nativeTransfers: [{}],
      tokenTransfers: [],
    });
    expect(t).toBe('TRANSFER');
  });

  it('returns UNKNOWN when nothing matches', () => {
    const t = __testing.deriveType({ _hints: {}, nativeTransfers: [], tokenTransfers: [] });
    expect(t).toBe('UNKNOWN');
  });

  it('hasBubblegum without specific cnft hint and no transfers falls back to COMPRESSED_NFT_TRANSFER', () => {
    // Locks the documented behavior: when the discriminator decoder did not
    // match a known op (e.g. delegate, update_metadata) but the tx touched
    // Bubblegum, bucket as COMPRESSED_NFT_TRANSFER (the most common op).
    const t = __testing.deriveType({
      _hints: { hasBubblegum: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('COMPRESSED_NFT_TRANSFER');
  });

  it('specific cnft hint takes precedence over hasBubblegum fallback', () => {
    // hasCnftBurn precedence row beats the hasBubblegum fallback that
    // deriveType only consults after the no-transfers branch.
    const t = __testing.deriveType({
      _hints: { hasBubblegum: true, hasCnftBurn: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('COMPRESSED_NFT_BURN');
  });

  it('TRANSFER (native/token transfers present) takes precedence over hasBubblegum fallback', () => {
    // Bubblegum bucketing kicks in only when no transfers exist; if any
    // native or token transfer is recorded the tx is a TRANSFER.
    const t = __testing.deriveType({
      _hints: { hasBubblegum: true },
      nativeTransfers: [{}],
      tokenTransfers: [],
    });
    expect(t).toBe('TRANSFER');
  });
});

describe('collectInstructionMetadata', () => {
  const collect = __testing.collectInstructionMetadata;

  it('returns empty array for raw tx with no instructions', () => {
    expect(collect({})).toEqual([]);
    expect(collect({ transaction: { message: { instructions: [] } } })).toEqual([]);
  });

  it('returns 0 inner count when meta.innerInstructions is missing', () => {
    const out = collect({
      transaction: {
        message: {
          instructions: [{ programId: 'A' }, { programId: 'B' }],
        },
      },
    });
    expect(out).toEqual([
      { programId: 'A', innerInstructionsCount: 0 },
      { programId: 'B', innerInstructionsCount: 0 },
    ]);
  });

  it('aligns inner instructions by group.index — including sparse indices', () => {
    // Top has 4 ixs but only ix#0 and ix#3 emitted CPIs.
    const out = collect({
      transaction: {
        message: {
          instructions: [
            { programId: 'A' },
            { programId: 'B' },
            { programId: 'C' },
            { programId: 'D' },
          ],
        },
      },
      meta: {
        innerInstructions: [
          { index: 0, instructions: [{}, {}, {}] }, // 3 inner under ix #0
          { index: 3, instructions: [{}] }, // 1 inner under ix #3
        ],
      },
    });
    expect(out).toEqual([
      { programId: 'A', innerInstructionsCount: 3 },
      { programId: 'B', innerInstructionsCount: 0 },
      { programId: 'C', innerInstructionsCount: 0 },
      { programId: 'D', innerInstructionsCount: 1 },
    ]);
  });

  it('handles innerInstructions group with missing instructions array', () => {
    const out = collect({
      transaction: { message: { instructions: [{ programId: 'P' }] } },
      meta: { innerInstructions: [{ index: 0 }] }, // no instructions[]
    });
    expect(out).toEqual([{ programId: 'P', innerInstructionsCount: 0 }]);
  });

  it('handles duplicate program IDs at different positions independently', () => {
    // Repeated programId — counts must follow position, not programId.
    const out = collect({
      transaction: {
        message: {
          instructions: [{ programId: 'X' }, { programId: 'X' }],
        },
      },
      meta: {
        innerInstructions: [{ index: 1, instructions: [{}, {}] }],
      },
    });
    expect(out).toEqual([
      { programId: 'X', innerInstructionsCount: 0 },
      { programId: 'X', innerInstructionsCount: 2 },
    ]);
  });
});

describe('real version 1 transaction (devnet)', () => {
  // `getTransaction` (jsonParsed, maxSupportedTransactionVersion: 1) response
  // for 59yqrkEWnukeNduX7aFzU6C8vqdhAdAUkRyvFUMRyAP6b2cHn4LtHXYspV1cXWbWv8E1t7V4Cm9qFRCC1UVCM6Ku,
  // a 2172-byte v1 transfer + memo sent on devnet on 2026-09-08 with
  // priorityFeeLamports: 1000. Regenerate by re-sending with @solana/kit 8 and
  // dumping the parsed response.
  const rawTx = require('./fixtures/v1-devnet-transfer-memo.json');

  it('is a v1 response with the config the node exposes', () => {
    expect(rawTx.version).toBe(1);
    expect(rawTx.transaction.message.transactionConfig).toEqual({
      computeUnitLimit: 1400000,
      heapSize: null,
      loadedAccountsDataSizeLimit: 262144,
      priorityFee: 1000,
    });
  });

  it('parses like any other transfer, with the priority fee already inside meta.fee', () => {
    const result = parseTransaction(rawTx);

    expect(result.type).toBe('TRANSFER');
    expect(result.fee).toBe(6000);
    expect(result.feePayer).toBe('4SLPz1KMRTcu878P45JRfekegjTbU3NzXX6nRHD5Gr9Q');
    expect(result.nativeTransfers).toEqual([
      {
        fromUserAccount: '4SLPz1KMRTcu878P45JRfekegjTbU3NzXX6nRHD5Gr9Q',
        toUserAccount: 'HCRPYbq4bsfmCng6A7t3QkP3kwW2vcgp4tu8VbMgrTnC',
        amount: 1000000,
      },
    ]);
  });
});
