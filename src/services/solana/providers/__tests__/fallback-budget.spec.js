'use strict';

/**
 * The Helius free-tier guardrail is only a guardrail if every path that
 * reaches Helius consumes it. Triton is hardcoded as unconfigured for
 * testnet, so the 'Triton not configured' branches carry real, unauthenticated
 * per-request traffic — not just an edge case.
 */

jest.mock('../../../../infrastructure/triton-client', () => ({
  ...jest.requireActual('../../../../infrastructure/triton-client'),
  isConfigured: jest.fn(() => false),
}));

const tritonClient = require('../../../../infrastructure/triton-client');
const resolver = require('../index');

const { resetBudget, consumeFallbackBudget } = resolver.__testing;

const DEFAULT_MAX_RPS = 8;

const exhaustBudget = () => {
  resetBudget();
  for (let i = 0; i < DEFAULT_MAX_RPS; i += 1) consumeFallbackBudget();
};

beforeEach(() => {
  jest.clearAllMocks();
  tritonClient.isConfigured.mockReturnValue(false);
  resetBudget();
});

describe('fallback budget on the "Triton not configured" branches', () => {
  test('getRpcUrl consumes the shared budget', () => {
    resetBudget();

    for (let i = 0; i < DEFAULT_MAX_RPS; i += 1) resolver.getRpcUrl('testnet');

    expect(consumeFallbackBudget()).toBe(false);
  });

  test('getRpcUrl refuses once the budget is exhausted', () => {
    exhaustBudget();

    expect(() => resolver.getRpcUrl('testnet')).toThrow(
      expect.objectContaining({ statusCode: 503, errorCode: 'upstream_rate_limited' })
    );
  });

  test('dispatchWithFallback refuses once the budget is exhausted', async () => {
    exhaustBudget();
    const fallback = jest.fn().mockResolvedValue({ ok: true, result: 'x', latency: 1 });

    await expect(
      resolver.__testing.dispatchWithFallback({ env: 'testnet', op: 'test' }, jest.fn(), fallback)
    ).rejects.toMatchObject({ statusCode: 503, errorCode: 'upstream_rate_limited' });
    expect(fallback).not.toHaveBeenCalled();
  });

  test('dispatchWithFallback still serves while the budget allows', async () => {
    resetBudget();
    const fallback = jest.fn().mockResolvedValue({ ok: true, result: 'x', latency: 1 });

    await expect(
      resolver.__testing.dispatchWithFallback({ env: 'testnet', op: 'test' }, jest.fn(), fallback)
    ).resolves.toBe('x');
  });
});
