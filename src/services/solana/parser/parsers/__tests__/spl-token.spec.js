'use strict';

/**
 * Unit tests for the SPL Token / Token-2022 parser.
 *
 * Targets the cases not covered by the integration-level parser.spec.js:
 *   - mintTo with `info.amount` only (no `tokenAmount` envelope)
 *   - mint resolution via `ctx.tokenAccountMints` when `info.mint` missing
 *   - tokenStandard heuristic (decimals=0 + amount=1 ⇒ NonFungible)
 *   - guard that drops transfers with no mint AND no source
 */

const splToken = require('../spl-token');

const mockCtx = ({ tokenAccountOwners = new Map(), tokenAccountMints = new Map() } = {}) => ({
  tokenAccountOwners,
  tokenAccountMints,
  building: {
    tokenTransfers: [],
    _hints: {},
  },
});

describe('spl-token parser', () => {
  test('exposes both Token + Token-2022 program ids', () => {
    expect(splToken.programIds).toEqual([
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    ]);
  });

  describe('transfer', () => {
    test('records transferChecked with tokenAmount envelope', () => {
      const ctx = mockCtx();
      splToken.parse(
        {
          parsed: {
            type: 'transferChecked',
            info: {
              authority: 'auth1',
              source: 'src-acc',
              destination: 'dest-acc',
              mint: 'MintXYZ',
              tokenAmount: { amount: '1000', decimals: 6 },
            },
          },
        },
        ctx
      );
      expect(ctx.building.tokenTransfers).toHaveLength(1);
      expect(ctx.building.tokenTransfers[0]).toMatchObject({
        fromUserAccount: 'auth1',
        fromTokenAccount: 'src-acc',
        toTokenAccount: 'dest-acc',
        mint: 'MintXYZ',
        tokenAmount: '1000',
        decimals: 6,
        tokenStandard: 'Fungible',
      });
    });

    test('falls back to flat info.amount + info.decimals when no tokenAmount envelope', () => {
      const ctx = mockCtx();
      splToken.parse(
        {
          parsed: {
            type: 'transfer',
            info: {
              authority: 'auth',
              source: 'src',
              destination: 'dst',
              mint: 'M',
              amount: 250,
              decimals: 2,
            },
          },
        },
        ctx
      );
      expect(ctx.building.tokenTransfers[0]).toMatchObject({
        tokenAmount: '250',
        decimals: 2,
      });
    });

    test('resolves mint from ctx.tokenAccountMints when info.mint missing', () => {
      const ctx = mockCtx({
        tokenAccountMints: new Map([['src', 'ResolvedMint']]),
      });
      splToken.parse(
        {
          parsed: {
            type: 'transfer',
            info: {
              authority: 'a',
              source: 'src',
              destination: 'dst',
              amount: '5',
            },
          },
        },
        ctx
      );
      expect(ctx.building.tokenTransfers[0].mint).toBe('ResolvedMint');
    });

    test('resolves toUserAccount via tokenAccountOwners', () => {
      const ctx = mockCtx({
        tokenAccountOwners: new Map([['dst', 'OwnerWallet']]),
      });
      splToken.parse(
        {
          parsed: {
            type: 'transfer',
            info: {
              authority: 'a',
              source: 'src',
              destination: 'dst',
              mint: 'M',
              amount: '1',
            },
          },
        },
        ctx
      );
      expect(ctx.building.tokenTransfers[0].toUserAccount).toBe('OwnerWallet');
    });

    test('skips transfers with neither mint nor source', () => {
      const ctx = mockCtx();
      splToken.parse(
        {
          parsed: {
            type: 'transfer',
            info: { authority: 'a', destination: 'dst', amount: '1' },
          },
        },
        ctx
      );
      expect(ctx.building.tokenTransfers).toHaveLength(0);
    });

    test('classifies decimals=0 + amount=1 as NonFungible', () => {
      const ctx = mockCtx();
      splToken.parse(
        {
          parsed: {
            type: 'transfer',
            info: {
              authority: 'a',
              source: 'src',
              destination: 'dst',
              mint: 'NftMint',
              amount: 1,
              decimals: 0,
            },
          },
        },
        ctx
      );
      expect(ctx.building.tokenTransfers[0].tokenStandard).toBe('NonFungible');
    });
  });

  describe('mintTo', () => {
    test('marks hint and pushes _mintEvent transfer with amount-only fallback', () => {
      const ctx = mockCtx({
        tokenAccountOwners: new Map([['recipient-acc', 'Recipient']]),
      });
      splToken.parse(
        {
          parsed: {
            type: 'mintTo',
            info: {
              account: 'recipient-acc',
              mint: 'MintedToken',
              amount: '100',
              decimals: 6,
            },
          },
        },
        ctx
      );
      expect(ctx.building._hints.hasMint).toBe(true);
      expect(ctx.building.tokenTransfers).toHaveLength(1);
      expect(ctx.building.tokenTransfers[0]).toMatchObject({
        fromUserAccount: null,
        toUserAccount: 'Recipient',
        toTokenAccount: 'recipient-acc',
        mint: 'MintedToken',
        tokenAmount: '100',
        decimals: 6,
        _mintEvent: true,
      });
    });

    test('mintToChecked uses tokenAmount envelope', () => {
      const ctx = mockCtx();
      splToken.parse(
        {
          parsed: {
            type: 'mintToChecked',
            info: {
              account: 'a',
              mint: 'M',
              tokenAmount: { amount: '999', decimals: 9 },
            },
          },
        },
        ctx
      );
      expect(ctx.building.tokenTransfers[0]).toMatchObject({
        tokenAmount: '999',
        decimals: 9,
        _mintEvent: true,
      });
    });
  });

  describe('burn', () => {
    test('marks hasBurn hint and pushes _burnEvent transfer', () => {
      const ctx = mockCtx();
      splToken.parse(
        {
          parsed: {
            type: 'burnChecked',
            info: {
              authority: 'wallet',
              account: 'tok-acc',
              mint: 'BurnMint',
              tokenAmount: { amount: '1', decimals: 0 },
            },
          },
        },
        ctx
      );
      expect(ctx.building._hints.hasBurn).toBe(true);
      expect(ctx.building.tokenTransfers[0]).toMatchObject({
        fromUserAccount: 'wallet',
        toUserAccount: null,
        fromTokenAccount: 'tok-acc',
        mint: 'BurnMint',
        tokenStandard: 'NonFungible',
        _burnEvent: true,
      });
    });
  });

  test('ignores instructions with no parsed type', () => {
    const ctx = mockCtx();
    splToken.parse({ parsed: null }, ctx);
    splToken.parse({ parsed: { info: {} } }, ctx);
    expect(ctx.building.tokenTransfers).toHaveLength(0);
    expect(ctx.building._hints).toEqual({});
  });

  test('ignores closeAccount / freeze / approve (not in our handled sets)', () => {
    const ctx = mockCtx();
    splToken.parse({ parsed: { type: 'closeAccount', info: { account: 'a' } } }, ctx);
    splToken.parse({ parsed: { type: 'freezeAccount', info: { account: 'a' } } }, ctx);
    expect(ctx.building.tokenTransfers).toHaveLength(0);
  });
});
