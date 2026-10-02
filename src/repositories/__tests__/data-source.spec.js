'use strict';

/**
 * The Redis connection carries wallet addresses and caller IPs, so whether
 * it is encrypted is a fact the privacy policy relies on. This pins the one
 * switch that decides it.
 */

const settingsWith = (env) => {
  let captured;
  jest.isolateModules(() => {
    jest.doMock('../../../packages/redis-connector', () => (settings) => {
      captured = settings;
      return {};
    });
    const previous = { ...process.env };
    Object.assign(process.env, { REDIS_HOST: 'redis.example', REDIS_PORT: '6379' }, env);
    if (!('REDIS_TLS' in env)) delete process.env.REDIS_TLS;
    try {
      require('../data-source');
    } finally {
      process.env = previous;
    }
  });
  return captured;
};

describe('data-source', () => {
  it('reaches Redis over TLS when REDIS_TLS is true', () => {
    expect(settingsWith({ REDIS_TLS: 'true' }).socket.tls).toBe(true);
  });

  it('stays on a plain connection for the local instance and for any other value', () => {
    expect(settingsWith({}).socket.tls).toBe(false);
    expect(settingsWith({ REDIS_TLS: 'false' }).socket.tls).toBe(false);
    expect(settingsWith({ REDIS_TLS: '1' }).socket.tls).toBe(false);
  });
});
