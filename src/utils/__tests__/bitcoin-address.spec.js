'use strict';

const { isValidBitcoinAddress } = require('../bitcoin-address');

describe('isValidBitcoinAddress', () => {
  it.each([
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
    'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn',
  ])('accepts %s', (address) => {
    expect(isValidBitcoinAddress(address)).toBe(true);
  });

  it.each(['', 'not-an-address', '0OIl1A1zP1eP5QGefi2DMPTfTL5SLmv7Di', 'BC1QAR0SRRR', 42, null])(
    'rejects %p',
    (value) => {
      expect(isValidBitcoinAddress(value)).toBe(false);
    }
  );
});
