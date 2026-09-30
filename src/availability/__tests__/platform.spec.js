'use strict';

const { platformOf, PLATFORMS } = require('../platform');

const req = (value) => ({ headers: value === undefined ? {} : { 'x-salmon-platform': value } });

describe('availability/platform', () => {
  it.each(['ios', 'android', 'extension'])('accepts %s', (value) => {
    expect(platformOf(req(value))).toBe(value);
  });

  it('is case-insensitive and trims', () => {
    expect(platformOf(req(' Android '))).toBe('android');
  });

  it('treats a missing header as the most restrictive platform', () => {
    expect(platformOf(req())).toBe('ios');
  });

  it('treats an unknown value as the most restrictive platform', () => {
    expect(platformOf(req('web'))).toBe('ios');
  });

  it('exposes the three platforms', () => {
    expect(PLATFORMS).toEqual(['ios', 'android', 'extension']);
  });
});
