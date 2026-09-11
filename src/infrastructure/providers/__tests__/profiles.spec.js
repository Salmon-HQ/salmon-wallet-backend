'use strict';

const { getProfile, PROVIDER_NAMES } = require('../profiles');

describe('profiles', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of [
      'COINGECKO_API_KEY',
      'COINGECKO_API_URL',
      'HELIUS_TIER',
      'ZEROEX_MAX_RPS',
      'TRITON_MAX_RPS',
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('lists every provider with a complete row', () => {
    expect(PROVIDER_NAMES).toEqual([
      'coingecko',
      'helius',
      'triton',
      'zeroex',
      'blockdaemon',
      'dapp',
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

  it('gives CoinGecko the paid budget only on the pro-api host', () => {
    process.env.COINGECKO_API_KEY = 'k';
    process.env.COINGECKO_API_URL = 'https://api.coingecko.com';
    expect(getProfile('coingecko').rps).toBeCloseTo(25 / 60);
    process.env.COINGECKO_API_URL = 'https://pro-api.coingecko.com';
    expect(getProfile('coingecko').rps).toBeCloseTo(500 / 60);
  });

  it('honours <PROVIDER>_MAX_RPS overrides and keeps burst ≥ rps', () => {
    process.env.ZEROEX_MAX_RPS = '5';
    expect(getProfile('zeroex')).toMatchObject({ rps: 5, burst: 5 });
    process.env.TRITON_MAX_RPS = '200';
    expect(getProfile('triton')).toMatchObject({ rps: 200, burst: 200 });
    process.env.HELIUS_TIER = 'paid';
    expect(getProfile('helius').rps).toBe(50);
  });
});
