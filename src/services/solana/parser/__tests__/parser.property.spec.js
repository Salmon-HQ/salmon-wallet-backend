'use strict';

/**
 * Property-based tests (fast-check) for the transaction parser.
 *
 * The parser consumes whatever the RPC returns for an on-chain transaction,
 * i.e. attacker-shaped data: any program can emit any instruction, any log
 * line, any account list. Example-based specs pin known shapes; these pin
 * the invariants that must hold for *every* shape: the parser never throws,
 * and always answers the contract the resource layer relies on.
 */

const fc = require('fast-check');
const { parseTransaction } = require('..');
// The parser's own vocabulary (TYPE_PRECEDENCE + the TRANSFER / UNKNOWN
// fallbacks in deriveType). A new type must be added here on purpose: the
// resource layer maps each of these to a public shape.
const KNOWN_TYPES = new Set([
  'SWAP',
  'COMPRESSED_NFT_MINT',
  'COMPRESSED_NFT_BURN',
  'COMPRESSED_NFT_TRANSFER',
  'NFT_MINT',
  'BURN_NFT',
  'TOKEN_MINT',
  'BURN',
  'OFFER_LOAN',
  'STAKE_TOKEN',
  'UNSTAKE_TOKEN',
  'TRANSFER',
  'UNKNOWN',
]);

const base58 = fc.stringMatching(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

const parsedInstruction = fc.record(
  {
    programId: base58,
    program: fc.string(),
    parsed: fc.oneof(
      fc.constant(undefined),
      fc.string(),
      fc.record({ type: fc.string(), info: fc.dictionary(fc.string(), fc.jsonValue()) })
    ),
    accounts: fc.array(base58, { maxLength: 6 }),
    data: fc.string(),
  },
  { requiredKeys: ['programId'] }
);

const rawTransaction = fc.record(
  {
    blockTime: fc.option(fc.integer({ min: 0 })),
    slot: fc.option(fc.nat()),
    version: fc.constantFrom(0, 1, 'legacy'),
    meta: fc.record(
      {
        err: fc.option(fc.jsonValue()),
        fee: fc.nat(),
        logMessages: fc.array(fc.string(), { maxLength: 20 }),
        innerInstructions: fc.array(
          fc.record({
            index: fc.nat(),
            instructions: fc.array(parsedInstruction, { maxLength: 4 }),
          }),
          { maxLength: 3 }
        ),
        preTokenBalances: fc.array(fc.jsonValue(), { maxLength: 4 }),
        postTokenBalances: fc.array(fc.jsonValue(), { maxLength: 4 }),
      },
      { requiredKeys: [] }
    ),
    transaction: fc.record({
      signatures: fc.array(base58, { maxLength: 2 }),
      message: fc.record(
        {
          accountKeys: fc.array(
            fc.oneof(base58, fc.record({ pubkey: base58, signer: fc.boolean() })),
            { maxLength: 8 }
          ),
          instructions: fc.array(parsedInstruction, { maxLength: 6 }),
        },
        { requiredKeys: [] }
      ),
    }),
  },
  { requiredKeys: ['transaction'] }
);

describe('parseTransaction (property-based)', () => {
  it('never throws on any structurally plausible RPC transaction', () => {
    fc.assert(
      fc.property(rawTransaction, (rawTx) => {
        const result = parseTransaction(rawTx);
        expect(result).not.toBeNull();
        expect(KNOWN_TYPES.has(result.type)).toBe(true);
        expect(Array.isArray(result.nativeTransfers)).toBe(true);
        expect(Array.isArray(result.tokenTransfers)).toBe(true);
        expect(typeof result.fee).toBe('number');
      }),
      { numRuns: 300 }
    );
  });

  it('never throws on arbitrary JSON, and returns null only for falsy input', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const result = parseTransaction(value);
        if (!value) {
          expect(result).toBeNull();
        } else if (typeof value === 'object') {
          expect(result).not.toBeNull();
        }
      }),
      { numRuns: 300 }
    );
  });
});
