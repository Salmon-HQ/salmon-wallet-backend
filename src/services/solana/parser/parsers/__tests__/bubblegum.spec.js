'use strict';

/**
 * Unit tests for the Bubblegum (compressed NFT) parser.
 *
 * Coverage targets:
 *   - Anchor discriminator computation (matches sha256("global:<name>"))
 *   - DISCRIMINATORS table reachable for all op categories
 *   - LOG_NAME_TO_OP categories
 *   - parse() classifies via discriminator (level 1)
 *   - parse() falls through to log scan when discriminator missing (level 2)
 *   - parse() always sets hasBubblegum hint
 */

const crypto = require('node:crypto');
const bubblegum = require('../bubblegum');

const { DISCRIMINATORS, LOG_NAME_TO_OP, anchorDiscriminator } = bubblegum.__testing;

const BUBBLEGUM_PROGRAM_ID = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';

const mockCtx = (logMessages = []) => ({
  logMessages,
  building: { _hints: {} },
});

const discriminatorBase64 = (instructionName) => {
  const buf = crypto.createHash('sha256').update(`global:${instructionName}`).digest().slice(0, 8);
  // Pad with two zero bytes so total length > 8 to also exercise length check.
  return Buffer.concat([buf, Buffer.from([0, 0])]).toString('base64');
};

describe('bubblegum parser', () => {
  test('programIds contains the canonical Bubblegum program', () => {
    expect(bubblegum.programIds).toEqual([BUBBLEGUM_PROGRAM_ID]);
  });

  describe('anchorDiscriminator', () => {
    test('returns first 8 bytes of sha256("global:<name>") as hex', () => {
      const expected = crypto
        .createHash('sha256')
        .update('global:transfer')
        .digest()
        .slice(0, 8)
        .toString('hex');
      expect(anchorDiscriminator('transfer')).toBe(expected);
    });
  });

  describe('DISCRIMINATORS table', () => {
    test('mint_v1 + mint_to_collection_v1 map to mint op', () => {
      expect(DISCRIMINATORS[anchorDiscriminator('mint_v1')]).toBe('mint');
      expect(DISCRIMINATORS[anchorDiscriminator('mint_to_collection_v1')]).toBe('mint');
    });

    test('transfer maps to transfer op', () => {
      expect(DISCRIMINATORS[anchorDiscriminator('transfer')]).toBe('transfer');
    });

    test('burn maps to burn op', () => {
      expect(DISCRIMINATORS[anchorDiscriminator('burn')]).toBe('burn');
    });

    test('verify_collection / delegate map to other op', () => {
      expect(DISCRIMINATORS[anchorDiscriminator('verify_collection')]).toBe('other');
      expect(DISCRIMINATORS[anchorDiscriminator('delegate')]).toBe('other');
    });
  });

  describe('LOG_NAME_TO_OP', () => {
    test('TitleCase Anchor names map to op categories', () => {
      expect(LOG_NAME_TO_OP.MintV1).toBe('mint');
      expect(LOG_NAME_TO_OP.MintToCollectionV1).toBe('mint');
      expect(LOG_NAME_TO_OP.Transfer).toBe('transfer');
      expect(LOG_NAME_TO_OP.Burn).toBe('burn');
      expect(LOG_NAME_TO_OP.UnknownInstruction).toBeUndefined();
    });
  });

  describe('parse()', () => {
    test('always tags hasBubblegum hint', () => {
      const ctx = mockCtx();
      bubblegum.parse({ data: undefined }, ctx);
      expect(ctx.building._hints.hasBubblegum).toBe(true);
    });

    test('classifies via base58-encoded discriminator (web3 getParsedTransaction data)', () => {
      // Regression guard for the bs58 v6 CJS export shape: if `bs58.decode`
      // stops being a function (as with a bare `require('bs58')` on v6),
      // the try/catch silently misroutes base58 data to the base64 path and
      // this classification breaks with no error anywhere.
      const bs58 = require('bs58').default;
      const buf = crypto.createHash('sha256').update('global:mint_v1').digest().slice(0, 8);
      const ctx = mockCtx();
      bubblegum.parse({ data: bs58.encode(Buffer.concat([buf, Buffer.from([0, 0])])) }, ctx);
      expect(ctx.building._hints.hasCnftMint).toBe(true);
    });

    test('classifies via base64-encoded discriminator (Triton-style data)', () => {
      const ctx = mockCtx();
      bubblegum.parse({ data: discriminatorBase64('transfer') }, ctx);
      expect(ctx.building._hints.hasCnftTransfer).toBe(true);
    });

    test('classifies mint discriminator', () => {
      const ctx = mockCtx();
      bubblegum.parse({ data: discriminatorBase64('mint_v1') }, ctx);
      expect(ctx.building._hints.hasCnftMint).toBe(true);
    });

    test('falls back to log scan when discriminator missing', () => {
      const ctx = mockCtx([
        `Program ${BUBBLEGUM_PROGRAM_ID} invoke [1]`,
        'Program log: Instruction: Burn',
        `Program ${BUBBLEGUM_PROGRAM_ID} success`,
      ]);
      bubblegum.parse({ data: undefined }, ctx);
      expect(ctx.building._hints.hasCnftBurn).toBe(true);
    });

    test('log-scan: ignores non-Bubblegum invoke blocks', () => {
      const ctx = mockCtx([
        'Program OtherProgram invoke [1]',
        'Program log: Instruction: Transfer',
        'Program OtherProgram success',
      ]);
      bubblegum.parse({ data: undefined }, ctx);
      expect(ctx.building._hints.hasCnftTransfer).toBeUndefined();
    });

    test('log-scan: first matching instruction wins', () => {
      const ctx = mockCtx([
        `Program ${BUBBLEGUM_PROGRAM_ID} invoke [1]`,
        'Program log: Instruction: Transfer',
        'Program log: Instruction: Burn',
        `Program ${BUBBLEGUM_PROGRAM_ID} success`,
      ]);
      bubblegum.parse({ data: undefined }, ctx);
      expect(ctx.building._hints.hasCnftTransfer).toBe(true);
      expect(ctx.building._hints.hasCnftBurn).toBeUndefined();
    });

    test('log-scan: leaves no specific cnft hint for "other" ops', () => {
      const ctx = mockCtx([
        `Program ${BUBBLEGUM_PROGRAM_ID} invoke [1]`,
        'Program log: Instruction: VerifyCollection',
        `Program ${BUBBLEGUM_PROGRAM_ID} success`,
      ]);
      bubblegum.parse({ data: undefined }, ctx);
      // hasBubblegum still set by the orchestrator hook above; specific cnft hints not.
      expect(ctx.building._hints.hasBubblegum).toBe(true);
      expect(ctx.building._hints.hasCnftTransfer).toBeUndefined();
      expect(ctx.building._hints.hasCnftMint).toBeUndefined();
      expect(ctx.building._hints.hasCnftBurn).toBeUndefined();
    });

    test('returns null hint when data exists but discriminator does not match table and no logs', () => {
      const ctx = mockCtx([]);
      // 8 random bytes that won't match any known discriminator
      const fake = Buffer.from('deadbeefdeadbeef', 'hex').toString('base64');
      bubblegum.parse({ data: fake }, ctx);
      expect(ctx.building._hints.hasBubblegum).toBe(true);
      expect(ctx.building._hints.hasCnftTransfer).toBeUndefined();
    });
  });
});
