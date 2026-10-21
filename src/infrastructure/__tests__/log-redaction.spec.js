'use strict';

const util = require('util');
const { AxiosError } = require('axios');
const { redact, toSafeError } = require('../log-redaction');

const CG_KEY = 'cg-secret-key-1234567890';
const TRITON_TOKEN = 'triton-secret-token-1234567890';

// What console.* actually writes: util.format inspects objects to depth 2,
// which reaches an axios error's config.headers.
const printed = (value) => util.format('%O', value);

const axiosError = ({ url, headers = {}, method = 'get' }) =>
  new AxiosError(
    'Request failed with status code 500',
    'ERR_BAD_RESPONSE',
    { url, method, headers },
    { _header: `GET / HTTP/1.1\r\n${Object.entries(headers).map((h) => h.join(': '))}\r\n\r\n` },
    { status: 500, data: {}, headers: {} }
  );

describe('log-redaction', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TRITON_API_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('redact', () => {
    it('replaces TRITON_API_TOKEN anywhere in the string', () => {
      process.env.TRITON_API_TOKEN = TRITON_TOKEN;
      const safe = redact(`axios timeout while fetching https://x.example.com/${TRITON_TOKEN}`);
      expect(safe).not.toContain(TRITON_TOKEN);
      expect(safe).toContain('[REDACTED]');
    });

    it('redacts rpcpool.com path segments even without TRITON_API_TOKEN set', () => {
      const safe = redact(`request to https://x.solana-mainnet.rpcpool.com/${TRITON_TOKEN} failed`);
      expect(safe).not.toContain(TRITON_TOKEN);
      expect(safe).toContain('rpcpool.com/[REDACTED]');
    });

    it('redacts an api-key query parameter', () => {
      const safe = redact(`GET https://mainnet.helius-rpc.com/?api-key=${CG_KEY}&x=1`);
      expect(safe).toBe('GET https://mainnet.helius-rpc.com/?api-key=[REDACTED]&x=1');
    });

    it('returns non-string inputs unchanged', () => {
      expect(redact(undefined)).toBeUndefined();
      expect(redact(null)).toBeNull();
      expect(redact(42)).toBe(42);
    });
  });

  describe('toSafeError', () => {
    it('keeps the diagnostic fields of an axios error', () => {
      const error = axiosError({
        url: 'https://pro-api.coingecko.com/api/v3/simple/price?ids=solana',
        headers: { 'x-cg-pro-api-key': CG_KEY },
      });

      expect(toSafeError(error)).toEqual({
        message: 'Request failed with status code 500',
        code: 'ERR_BAD_RESPONSE',
        status: 500,
        method: 'GET',
        url: 'https://pro-api.coingecko.com',
      });
    });

    it('never carries a header credential into the logged output', () => {
      const error = axiosError({
        url: 'https://pro-api.coingecko.com/api/v3/simple/price',
        headers: { 'x-cg-pro-api-key': CG_KEY },
      });

      expect(printed(error)).toContain(CG_KEY);
      expect(printed(toSafeError(error))).not.toContain(CG_KEY);
    });

    it('never carries the Triton token in the request url into the logged output', () => {
      const error = axiosError({
        url: `https://tenant.solana-mainnet.rpcpool.com/${TRITON_TOKEN}`,
        method: 'post',
      });

      const safe = toSafeError(error);

      expect(printed(safe)).not.toContain(TRITON_TOKEN);
      expect(safe.url).toBe('https://tenant.solana-mainnet.rpcpool.com');
    });

    it('redacts a credential echoed in the message of a non-axios error', () => {
      const safe = toSafeError(
        new Error(`request to https://x.rpcpool.com/${TRITON_TOKEN} failed, reason: ECONNRESET`)
      );

      expect(safe.message).not.toContain(TRITON_TOKEN);
      expect(safe.url).toBeUndefined();
    });
  });
});
