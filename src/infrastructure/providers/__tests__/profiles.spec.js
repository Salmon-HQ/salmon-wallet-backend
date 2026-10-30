'use strict';

const { getProfile, PROVIDER_NAMES } = require('../profiles');

describe('profiles', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of [
      'COINGECKO_API_KEY',
      'COINGECKO_API_URL',
      'TRITON_MAX_RPS',
      'SOLANA_PUBLIC_MAX_RPS',
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('lists every provider with a complete row', () => {
    expect(PROVIDER_NAMES).toEqual([
      'coingecko',
      'triton',
      'solana-public',
      'mempool',
      'blockstream',
      'dapp',
      'trm',
      'jupiter',
      'zeroex',
      'encrypt-executor',
      'dagon-config',
    ]);
    for (const name of PROVIDER_NAMES) {
      expect(getProfile(name)).toMatchObject({
        name,
        rps: expect.any(Number),
        burst: expect.any(Number),
        timeoutMs: expect.any(Number),
        retry: expect.objectContaining({ maxAttempts: expect.any(Number) }),
      });
    }
    expect(() => getProfile('nope')).toThrow(/Unknown provider profile/);
  });

  // A retried createInput can mint a second executor input; the build's wait loop is the retry.
  it('runs the two Dagon upstreams with no retry and the default breaker', () => {
    const noRetry = { maxAttempts: 1, baseMs: 0, maxMs: 0, honorRetryAfter: false };
    const breaker = { failures: 5, cooldownMs: 30000 };
    expect(getProfile('encrypt-executor')).toEqual({
      name: 'encrypt-executor',
      rps: 5,
      burst: 10,
      timeoutMs: 5000,
      retry: noRetry,
      breaker,
    });
    expect(getProfile('dagon-config')).toEqual({
      name: 'dagon-config',
      rps: 1,
      burst: 5,
      timeoutMs: 3000,
      retry: noRetry,
      breaker,
    });
  });

  it('gives CoinGecko the paid budget only on the pro-api host', () => {
    process.env.COINGECKO_API_KEY = 'k';
    process.env.COINGECKO_API_URL = 'https://api.coingecko.com';
    expect(getProfile('coingecko').rps).toBeCloseTo(25 / 60);
    process.env.COINGECKO_API_URL = 'https://pro-api.coingecko.com';
    expect(getProfile('coingecko').rps).toBeCloseTo(500 / 60);
  });

  it('honours <PROVIDER>_MAX_RPS overrides and keeps burst ≥ rps', () => {
    process.env.TRITON_MAX_RPS = '200';
    expect(getProfile('triton')).toMatchObject({ rps: 200, burst: 200 });
    process.env.SOLANA_PUBLIC_MAX_RPS = '2';
    expect(getProfile('solana-public')).toMatchObject({ rps: 2, burst: 10 });
  });
});
