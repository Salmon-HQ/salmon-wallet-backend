'use strict';

const { resolveSourceIp } = require('./index');

describe('resolveSourceIp', () => {
  it('prefers the address API Gateway attached to the request', () => {
    const req = {
      requestContext: { identity: { sourceIp: '1.2.3.4' } },
      headers: { 'x-forwarded-for': '9.9.9.9, 5.6.7.8' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(resolveSourceIp(req)).toBe('1.2.3.4');
  });

  it('falls back to the LAST X-Forwarded-For entry, which API Gateway appends', () => {
    const req = { headers: { 'x-forwarded-for': '9.9.9.9, 5.6.7.8' }, socket: {} };
    expect(resolveSourceIp(req)).toBe('5.6.7.8');
  });

  it('falls back to the socket for direct connections', () => {
    expect(resolveSourceIp({ headers: {}, socket: { remoteAddress: '::1' } })).toBe('::1');
  });

  it('answers undefined when nothing is known', () => {
    expect(resolveSourceIp({ headers: {}, socket: {} })).toBeUndefined();
  });
});
