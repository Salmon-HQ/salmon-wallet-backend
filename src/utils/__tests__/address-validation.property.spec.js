'use strict';

/**
 * Property-based tests (fast-check) for the request-boundary address
 * validators. They sit in front of every chain call, so they must be total
 * over arbitrary input and must accept every well-formed key.
 */

const fc = require('fast-check');
const { PublicKey } = require('@solana/web3.js');
const { isValidSolanaAddress, findInvalidAddressParam } = require('../solana-address');
const { isValidBitcoinAddress } = require('../bitcoin-address');

describe('address validators (property-based)', () => {
  it('isValidSolanaAddress never throws and only returns booleans', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(typeof isValidSolanaAddress(value)).toBe('boolean');
      }),
      { numRuns: 500 }
    );
  });

  it('accepts the base58 form of any 32-byte public key', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (bytes) => {
        expect(isValidSolanaAddress(new PublicKey(bytes).toBase58())).toBe(true);
      })
    );
  });

  it('findInvalidAddressParam ignores absent values and names the first bad one', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ minLength: 1 }), fc.anything()), (params) => {
        const result = findInvalidAddressParam(params);
        const supplied = Object.entries(params).filter(
          ([, v]) => v !== undefined && v !== null && v !== ''
        );
        const firstBad = supplied.find(([, v]) => !isValidSolanaAddress(v));
        expect(result).toBe(firstBad ? firstBad[0] : null);
      }),
      { numRuns: 300 }
    );
  });

  it('isValidBitcoinAddress never throws, only returns booleans, and rejects non-strings', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const out = isValidBitcoinAddress(value);
        expect(typeof out).toBe('boolean');
        if (typeof value !== 'string') expect(out).toBe(false);
      }),
      { numRuns: 500 }
    );
  });
});
