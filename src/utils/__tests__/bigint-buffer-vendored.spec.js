'use strict';

/**
 * `bigint-buffer` is overridden by `vendor/bigint-buffer`: upstream's pure-JS
 * path without its native addon (GHSA-3gc7-fjrx-p6mg). These pin both halves
 * of that: the vendored copy is the one spl-token loads, and the numbers it
 * decodes are the numbers on chain.
 */

const fs = require('fs');
const { AccountLayout, MintLayout } = require('@solana/spl-token');
const bigintBuffer = require('bigint-buffer');

const U64_MAX = 2n ** 64n - 1n;

describe('vendored bigint-buffer', () => {
  it('is the pure-JS copy, with no native addon to load', () => {
    expect(require('bigint-buffer/package.json').version).toBe('1.2.0-salmon.0');
    expect(require.resolve('bigint-buffer')).toMatch(/node_modules\/bigint-buffer\/index\.js$/);
    const source = fs.readFileSync(require.resolve('bigint-buffer'), 'utf8');
    expect(source).not.toMatch(/require\((['"])bindings\1\)/);
  });

  it.each([0n, 1n, 255n, 256n, 1_000_000_000n, U64_MAX])('round-trips %s like Node does', (n) => {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(n);
    const be = Buffer.alloc(8);
    be.writeBigUInt64BE(n);
    expect(bigintBuffer.toBufferLE(n, 8)).toEqual(le);
    expect(bigintBuffer.toBufferBE(n, 8)).toEqual(be);
    expect(bigintBuffer.toBigIntLE(le)).toBe(n);
    expect(bigintBuffer.toBigIntBE(be)).toBe(n);
  });

  it('decodes spl-token amounts and supplies through it', () => {
    const account = Buffer.alloc(AccountLayout.span);
    account.writeBigUInt64LE(U64_MAX, 64);
    expect(AccountLayout.decode(account).amount).toBe(U64_MAX);

    const mint = Buffer.alloc(MintLayout.span);
    mint.writeBigUInt64LE(1_234_567_890_123n, 36);
    expect(MintLayout.decode(mint).supply).toBe(1_234_567_890_123n);
  });
});
