const { isEmpty } = require('./index');

describe('Objects', () => {
  test('null object should be empty', () => {
    expect(isEmpty(null)).toBe(true);
  });

  test('undefined object should be empty', () => {
    expect(isEmpty(undefined)).toBe(true);
  });

  test('{} object should be empty', () => {
    expect(isEmpty({})).toBe(true);
  });

  test('empty string should be undefined', () => {
    expect(isEmpty('')).toBe(undefined);
  });

  test('NaN should be undefined', () => {
    expect(isEmpty(NaN)).toBe(undefined);
  });

  test('0 should be undefined', () => {
    expect(isEmpty(0)).toBe(undefined);
  });
});
