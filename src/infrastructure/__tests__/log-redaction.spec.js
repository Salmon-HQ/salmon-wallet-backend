'use strict';

const util = require('util');
const { AxiosError } = require('axios');
const { redact, toSafeError, withoutCredentials } = require('../log-redaction');

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

    it('redacts an rpcpool.com path segment whatever the host case', () => {
      const safe = redact(`https://X.Solana-Mainnet.RPCPOOL.COM/${TRITON_TOKEN}`);
      expect(safe).toBe('https://X.Solana-Mainnet.RPCPOOL.COM/[REDACTED]');
    });

    it.each([
      'api-key',
      'api_key',
      'apikey',
      'x_cg_pro_api_key',
      'x_cg_demo_api_key',
      'api_secret',
    ])('redacts a %s query parameter', (name) => {
      const safe = redact(`GET https://provider.example/v1?a=1&${name}=${CG_KEY}&x=1`);
      expect(safe).toBe(`GET https://provider.example/v1?a=1&${name}=[REDACTED]&x=1`);
    });

    it.each([
      [`x-cg-pro-api-key: ${CG_KEY}\r\nHost: x`, 'x-cg-pro-api-key: [REDACTED]\r\nHost: x'],
      [`x-cg-demo-api-key:${CG_KEY}`, 'x-cg-demo-api-key:[REDACTED]'],
      [`X-API-Key: ${CG_KEY}`, 'X-API-Key: [REDACTED]'],
      [`0x-api-key: ${CG_KEY}`, '0x-api-key: [REDACTED]'],
      [`{ 'x-api-key': '${CG_KEY}' }`, "{ 'x-api-key': '[REDACTED]' }"],
    ])('redacts a header credential written as text: %s', (text, expected) => {
      expect(redact(text)).toBe(expected);
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
        name: 'AxiosError',
        message: 'Request failed with status code 500',
        code: 'ERR_BAD_RESPONSE',
        status: 500,
        method: 'GET',
        url: 'https://pro-api.coingecko.com/api/v3/simple/price',
        stack: expect.stringContaining('AxiosError: Request failed with status code 500'),
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
      expect(safe.url).toBe('https://tenant.solana-mainnet.rpcpool.com/[REDACTED]');
    });

    it('redacts a credential echoed in the message of a non-axios error', () => {
      const safe = toSafeError(
        new Error(`request to https://x.rpcpool.com/${TRITON_TOKEN} failed, reason: ECONNRESET`)
      );

      expect(safe.message).not.toContain(TRITON_TOKEN);
      expect(safe.stack).not.toContain(TRITON_TOKEN);
      expect(safe.url).toBeUndefined();
    });

    it('keeps a thrown string as the message', () => {
      expect(toSafeError(`boom at https://x.rpcpool.com/${TRITON_TOKEN}`)).toMatchObject({
        message: 'boom at https://x.rpcpool.com/[REDACTED]',
      });
    });

    it.each([
      [undefined, 'undefined'],
      [null, 'null'],
    ])('describes a thrown %s instead of failing', (thrown, message) => {
      expect(toSafeError(thrown).message).toBe(message);
    });

    it('handles a circular object without a message', () => {
      const thrown = { reason: 'boom' };
      thrown.self = thrown;

      const safe = toSafeError(thrown);

      expect(safe.message).toBe('[object Object]');
      expect(() => printed(safe)).not.toThrow();
    });

    it('handles an object that cannot be turned into a string', () => {
      expect(toSafeError(Object.create(null)).message).toBe('[object Object]');
    });
  });

  describe('withoutCredentials', () => {
    const tritonFailure = () =>
      Object.assign(
        axiosError({ url: `https://tenant.solana-mainnet.rpcpool.com/${TRITON_TOKEN}` }),
        { message: `request to https://tenant.solana-mainnet.rpcpool.com/${TRITON_TOKEN} failed` }
      );

    it('strips the request and redacts the message and stack of the same error', () => {
      const error = tritonFailure();
      error.stack = `AxiosError: ${error.message}\n    at x`;

      const safe = withoutCredentials(error);

      expect(safe).toBe(error);
      // The Lambda runtime logs a rejected invocation with JSON.stringify.
      expect(JSON.stringify(safe)).not.toContain(TRITON_TOKEN);
      expect(printed(safe)).not.toContain(TRITON_TOKEN);
      expect(safe.message).toContain('rpcpool.com/[REDACTED]');
    });

    it('returns a redacted copy of an error it cannot change', () => {
      const safe = withoutCredentials(Object.freeze(tritonFailure()));

      expect(safe).toBeInstanceOf(Error);
      expect(JSON.stringify(safe)).not.toContain(TRITON_TOKEN);
      expect(printed(safe)).not.toContain(TRITON_TOKEN);
      expect(safe.message).toContain('rpcpool.com/[REDACTED]');
    });

    it.each([null, undefined, `boom ${TRITON_TOKEN}`])(
      'turns a thrown %s into an Error',
      (thrown) => {
        process.env.TRITON_API_TOKEN = TRITON_TOKEN;
        const safe = withoutCredentials(thrown);

        expect(safe).toBeInstanceOf(Error);
        expect(safe.message).not.toContain(TRITON_TOKEN);
      }
    );
  });
});
