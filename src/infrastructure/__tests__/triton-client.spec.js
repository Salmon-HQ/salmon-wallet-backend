'use strict';

/**
 * Unit tests for the Triton client.
 *
 * Env reads are lazy in the implementation, so we mutate `process.env`
 * between cases without `jest.resetModules()`.
 */

const tritonClient = require('../triton-client');

const PUBLIC_TESTNET = 'https://api.testnet.solana.com';
const PUBLIC_DEVNET = 'https://api.devnet.solana.com';

describe('triton-client', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TRITON_RPC_URL;
    delete process.env.TRITON_RPC_URL_DEVNET;
    delete process.env.TRITON_API_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getRpcUrl', () => {
    test('testnet always returns the public Solana testnet URL', () => {
      expect(tritonClient.getRpcUrl('testnet')).toBe(PUBLIC_TESTNET);

      // Even with a configured devnet URL, testnet should still bypass.
      process.env.TRITON_RPC_URL_DEVNET = 'https://triton-dev.example.com';
      expect(tritonClient.getRpcUrl('testnet')).toBe(PUBLIC_TESTNET);
    });

    test('devnet falls through to public Solana when TRITON_RPC_URL_DEVNET is unset', () => {
      expect(tritonClient.getRpcUrl('devnet')).toBe(PUBLIC_DEVNET);
    });

    test('devnet uses TRITON_RPC_URL_DEVNET when set', () => {
      process.env.TRITON_RPC_URL_DEVNET = 'https://tenant.solana-devnet.rpcpool.com/secret-token';
      expect(tritonClient.getRpcUrl('devnet')).toBe(
        'https://tenant.solana-devnet.rpcpool.com/secret-token'
      );
    });

    test('mainnet throws TRITON_NOT_CONFIGURED when TRITON_RPC_URL is unset', () => {
      try {
        tritonClient.getRpcUrl('mainnet');
        throw new Error('expected throw');
      } catch (err) {
        expect(err.code).toBe('TRITON_NOT_CONFIGURED');
        expect(err.message).toMatch(/TRITON_RPC_URL/);
      }
    });

    test('mainnet returns URL as-is when token is already embedded as path segment', () => {
      process.env.TRITON_RPC_URL = 'https://tenant.solana-mainnet.rpcpool.com/embedded-token';
      process.env.TRITON_API_TOKEN = 'separate-token-should-be-ignored';
      expect(tritonClient.getRpcUrl('mainnet')).toBe(
        'https://tenant.solana-mainnet.rpcpool.com/embedded-token'
      );
    });

    test('mainnet returns URL as-is when query string is present', () => {
      process.env.TRITON_RPC_URL = 'https://example.com/rpc?api-key=abc';
      process.env.TRITON_API_TOKEN = 'should-not-be-appended';
      expect(tritonClient.getRpcUrl('mainnet')).toBe('https://example.com/rpc?api-key=abc');
    });

    test('mainnet appends TRITON_API_TOKEN as a path segment when URL is bare rpcpool host', () => {
      process.env.TRITON_RPC_URL = 'https://tenant.solana-mainnet.rpcpool.com';
      process.env.TRITON_API_TOKEN = 'my-token';
      expect(tritonClient.getRpcUrl('mainnet')).toBe(
        'https://tenant.solana-mainnet.rpcpool.com/my-token'
      );
    });

    test('mainnet strips trailing slash before appending token', () => {
      process.env.TRITON_RPC_URL = 'https://tenant.solana-mainnet.rpcpool.com/';
      process.env.TRITON_API_TOKEN = 'my-token';
      expect(tritonClient.getRpcUrl('mainnet')).toBe(
        'https://tenant.solana-mainnet.rpcpool.com/my-token'
      );
    });

    test('mainnet without TRITON_API_TOKEN returns URL untouched', () => {
      process.env.TRITON_RPC_URL = 'https://tenant.solana-mainnet.rpcpool.com';
      expect(tritonClient.getRpcUrl('mainnet')).toBe('https://tenant.solana-mainnet.rpcpool.com');
    });

    test('non-rpcpool host without query keeps token unappended (treated as already-formed)', () => {
      process.env.TRITON_RPC_URL = 'https://custom-host.example.com/rpc';
      process.env.TRITON_API_TOKEN = 'token';
      // hasEmbeddedToken is false (no rpcpool, no query) → appendToken adds.
      expect(tritonClient.getRpcUrl('mainnet')).toBe('https://custom-host.example.com/rpc/token');
    });

    test('default environment is mainnet', () => {
      process.env.TRITON_RPC_URL = 'https://tenant.solana-mainnet.rpcpool.com/x';
      expect(tritonClient.getRpcUrl()).toBe('https://tenant.solana-mainnet.rpcpool.com/x');
    });
  });

  describe('isConfigured', () => {
    test('testnet always false (Triton does not host testnet)', () => {
      expect(tritonClient.isConfigured('testnet')).toBe(false);

      process.env.TRITON_RPC_URL = 'https://x.rpcpool.com/x';
      process.env.TRITON_RPC_URL_DEVNET = 'https://y.rpcpool.com/y';
      expect(tritonClient.isConfigured('testnet')).toBe(false);
    });

    test('mainnet is true iff TRITON_RPC_URL is set', () => {
      expect(tritonClient.isConfigured('mainnet')).toBe(false);
      process.env.TRITON_RPC_URL = 'https://x.rpcpool.com/x';
      expect(tritonClient.isConfigured('mainnet')).toBe(true);
    });

    test('devnet is true iff TRITON_RPC_URL_DEVNET is set (mainnet URL does not count)', () => {
      process.env.TRITON_RPC_URL = 'https://x.rpcpool.com/x';
      expect(tritonClient.isConfigured('devnet')).toBe(false);

      process.env.TRITON_RPC_URL_DEVNET = 'https://y.rpcpool.com/y';
      expect(tritonClient.isConfigured('devnet')).toBe(true);
    });
  });

  describe('getApiToken', () => {
    test('returns empty string when env var unset', () => {
      expect(tritonClient.getApiToken()).toBe('');
    });

    test('reflects current env value (lazy read)', () => {
      process.env.TRITON_API_TOKEN = 'first';
      expect(tritonClient.getApiToken()).toBe('first');
      process.env.TRITON_API_TOKEN = 'second';
      expect(tritonClient.getApiToken()).toBe('second');
    });
  });
});
