'use strict';

const { isValidSolanaAddress, findInvalidAddressParam } = require('../solana-address');

const VALID = 'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9';

describe('solana-address', () => {
  describe('isValidSolanaAddress', () => {
    it('accepts a base58 public key', () => {
      expect(isValidSolanaAddress(VALID)).toBe(true);
    });

    it.each([
      ['a non-base58 character', 'owner-1'],
      ['an empty string', ''],
      ['a too-short string', 'abc'],
      ['undefined', undefined],
      ['a number', 42],
      ['an object', {}],
    ])('rejects %s', (_label, value) => {
      expect(isValidSolanaAddress(value)).toBe(false);
    });
  });

  describe('findInvalidAddressParam', () => {
    it('returns null when every supplied value is valid', () => {
      expect(findInvalidAddressParam({ owner: VALID, destination: VALID })).toBeNull();
    });

    it('names the offending parameter', () => {
      expect(findInvalidAddressParam({ owner: VALID, destination: 'nope!' })).toBe('destination');
    });

    it('ignores absent values, leaving required-ness to the caller', () => {
      expect(findInvalidAddressParam({ owner: VALID, destination: undefined })).toBeNull();
    });
  });
});
