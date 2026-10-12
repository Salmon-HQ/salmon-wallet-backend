'use strict';

/**
 * bigint-buffer 1.1.5 with its native addon removed.
 *
 * The upstream package loads a C addon when it compiles and falls back to
 * these pure-JS conversions when it does not. The addon carries
 * GHSA-3gc7-fjrx-p6mg (buffer overflow in toBigIntLE) and no fixed release
 * exists; the fallback has no fixed-size buffer and is what browsers run. This
 * is that fallback, verbatim, so `@solana/buffer-layout-utils` never reaches
 * native code. Drop it once buffer-layout-utils stops depending on bigint-buffer
 * (solana-foundation/buffer-layout-utils#2).
 */

function toBigIntLE(buf) {
  const reversed = Buffer.from(buf);
  reversed.reverse();
  const hex = reversed.toString('hex');
  if (hex.length === 0) {
    return BigInt(0);
  }
  return BigInt(`0x${hex}`);
}

function toBigIntBE(buf) {
  const hex = buf.toString('hex');
  if (hex.length === 0) {
    return BigInt(0);
  }
  return BigInt(`0x${hex}`);
}

function toBufferLE(num, width) {
  const hex = num.toString(16);
  const buffer = Buffer.from(hex.padStart(width * 2, '0').slice(0, width * 2), 'hex');
  buffer.reverse();
  return buffer;
}

function toBufferBE(num, width) {
  const hex = num.toString(16);
  return Buffer.from(hex.padStart(width * 2, '0').slice(0, width * 2), 'hex');
}

module.exports = { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE };
