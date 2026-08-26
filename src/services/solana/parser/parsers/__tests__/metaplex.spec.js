'use strict';

const metaplex = require('../metaplex');

const mockCtx = () => ({ building: { _hints: {} } });

describe('metaplex parser', () => {
  test('programIds is canonical Metaplex Token Metadata', () => {
    expect(metaplex.programIds).toEqual(['metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s']);
  });

  test.each([
    'createMetadataAccount',
    'createMetadataAccountV2',
    'createMetadataAccountV3',
    'createMasterEdition',
    'createMasterEditionV3',
    'mint',
    'mintNewEditionFromMasterEditionViaToken',
  ])('mint-class type "%s" sets hasNftMint', (type) => {
    const ctx = mockCtx();
    metaplex.parse({ parsed: { type } }, ctx);
    expect(ctx.building._hints.hasNftMint).toBe(true);
    expect(ctx.building._hints.hasNftBurn).toBeUndefined();
  });

  test.each(['burn', 'burnNft', 'burnEditionNft'])(
    'burn-class type "%s" sets hasNftBurn',
    (type) => {
      const ctx = mockCtx();
      metaplex.parse({ parsed: { type } }, ctx);
      expect(ctx.building._hints.hasNftBurn).toBe(true);
      expect(ctx.building._hints.hasNftMint).toBeUndefined();
    }
  );

  test('unparsed instruction sets hasMetaplex hint only', () => {
    const ctx = mockCtx();
    metaplex.parse({ parsed: null }, ctx);
    expect(ctx.building._hints.hasMetaplex).toBe(true);
    expect(ctx.building._hints.hasNftMint).toBeUndefined();
    expect(ctx.building._hints.hasNftBurn).toBeUndefined();
  });

  test('unrecognized type leaves hints empty', () => {
    const ctx = mockCtx();
    metaplex.parse({ parsed: { type: 'someUnknownOp' } }, ctx);
    expect(ctx.building._hints).toEqual({});
  });
});
