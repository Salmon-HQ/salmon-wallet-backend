'use strict';

/**
 * Unit tests for `buildSwapRoute` — the helper that produces the
 * single-hop swapRoute the FE renders for SWAP transactions.
 *
 * Focus: naming inversion (user `outputs` → hop `inputToken`, user `inputs`
 * → hop `outputToken`), conversionRate decimal-aware ratio, defensive
 * paths (missing arrays, zero amounts).
 */

const transformTransaction = require('../solana-transaction-resource'); // not used; just to keep deps minimal
const { __testing } = require('../helius-transaction-resource');
const { buildSwapRoute } = __testing;

// Quiet linter — `transformTransaction` import only loads the module so the
// helius-transaction-resource module is initialized once.
void transformTransaction;

const inputToken = (overrides = {}) => ({
  amount: '1000000',
  decimals: 6,
  symbol: 'USDC',
  contract: 'USDCmint',
  logo: 'https://logo/usdc.png',
  ...overrides,
});

const outputToken = (overrides = {}) => ({
  amount: '500000000',
  decimals: 9,
  symbol: 'SOL',
  contract: 'So111...112',
  logo: 'https://logo/sol.png',
  ...overrides,
});

describe('buildSwapRoute', () => {
  it('returns null when inputs or outputs is empty', () => {
    expect(buildSwapRoute([], [outputToken()], 'JUPITER')).toBeNull();
    expect(buildSwapRoute([inputToken()], [], 'JUPITER')).toBeNull();
    expect(buildSwapRoute(undefined, undefined, 'JUPITER')).toBeNull();
  });

  it('inverts naming so hop.inputToken comes from user `outputs` (sent) and hop.outputToken from user `inputs` (received)', () => {
    // User SENT SOL (in outputs[]), user RECEIVED USDC (in inputs[]).
    const sent = outputToken({ symbol: 'SOL', amount: '1000000000', decimals: 9 });
    const received = inputToken({ symbol: 'USDC', amount: '120000000', decimals: 6 });
    const route = buildSwapRoute([received], [sent], 'JUPITER');

    expect(route.hops).toHaveLength(1);
    const hop = route.hops[0];
    expect(hop.dex).toBe('JUPITER');
    expect(hop.percent).toBe(100);
    expect(hop.inputToken.symbol).toBe('SOL');
    expect(hop.inputToken.amount).toBe('1000000000');
    expect(hop.inputToken.decimals).toBe(9);
    expect(hop.outputToken.symbol).toBe('USDC');
    expect(hop.outputToken.amount).toBe('120000000');
  });

  it('computes conversionRate as decimal-aware ratio with 6-digit precision', () => {
    // Sent 1 SOL (10^9 lamports), received 120 USDC (120 * 10^6).
    // Rate = 120 USDC / 1 SOL = 120.000000
    const sent = outputToken({ symbol: 'SOL', amount: '1000000000', decimals: 9 });
    const received = inputToken({ symbol: 'USDC', amount: '120000000', decimals: 6 });
    const route = buildSwapRoute([received], [sent], 'JUPITER');

    expect(route.conversionRate).toEqual({
      fromSymbol: 'SOL',
      toSymbol: 'USDC',
      rate: '120.000000',
    });
  });

  it('omits conversionRate when sent amount is zero (would be Infinity)', () => {
    const sent = outputToken({ symbol: 'SOL', amount: '0', decimals: 9 });
    const received = inputToken({ symbol: 'USDC', amount: '1', decimals: 6 });
    const route = buildSwapRoute([received], [sent], 'JUPITER');

    expect(route).not.toBeNull();
    expect(route.conversionRate).toBeUndefined();
  });

  it('exposes inputAmount and outputAmount as raw amount strings', () => {
    const sent = outputToken({ amount: '750000000' });
    const received = inputToken({ amount: '95000000' });
    const route = buildSwapRoute([received], [sent], 'JUPITER');

    expect(route.inputAmount).toBe('750000000');
    expect(route.outputAmount).toBe('95000000');
  });

  it('falls back to "UNKNOWN" dex when source is null', () => {
    const route = buildSwapRoute([inputToken()], [outputToken()], null);
    expect(route.hops[0].dex).toBe('UNKNOWN');
  });

  it('preserves logo URLs through to the hop tokens', () => {
    const route = buildSwapRoute(
      [inputToken({ logo: 'https://logo/usdc.png' })],
      [outputToken({ logo: 'https://logo/sol.png' })],
      'JUPITER'
    );
    expect(route.hops[0].inputToken.logo).toBe('https://logo/sol.png');
    expect(route.hops[0].outputToken.logo).toBe('https://logo/usdc.png');
  });

  it('treats logo undefined as null on the hop tokens', () => {
    const route = buildSwapRoute(
      [{ ...inputToken(), logo: undefined }],
      [{ ...outputToken(), logo: undefined }],
      'JUPITER'
    );
    expect(route.hops[0].inputToken.logo).toBeNull();
    expect(route.hops[0].outputToken.logo).toBeNull();
  });

  it('survives raw amounts above Number.MAX_SAFE_INTEGER (BigInt path)', () => {
    // 1_000_000_000 BONK at 18 decimals = 10^27 raw — well past 2^53.
    const sent = outputToken({
      symbol: 'BONK',
      amount: '1000000000000000000000000000',
      decimals: 18,
    });
    const received = inputToken({
      symbol: 'USDC',
      amount: '20000000000',
      decimals: 6,
    });
    const route = buildSwapRoute([received], [sent], 'JUPITER');

    expect(route.conversionRate).toBeDefined();
    // 20_000 USDC for 1_000_000_000 BONK = 0.00002 USDC/BONK
    expect(route.conversionRate.rate).toBe('0.000020');
  });

  it('returns the same conversion rate independent of the amounts magnitude', () => {
    const small = buildSwapRoute(
      [inputToken({ amount: '120000000', decimals: 6, symbol: 'USDC' })],
      [outputToken({ amount: '1000000000', decimals: 9, symbol: 'SOL' })],
      'JUPITER'
    );
    const big = buildSwapRoute(
      [inputToken({ amount: '120000000000000', decimals: 6, symbol: 'USDC' })],
      [outputToken({ amount: '1000000000000000', decimals: 9, symbol: 'SOL' })],
      'JUPITER'
    );
    expect(small.conversionRate.rate).toBe(big.conversionRate.rate);
  });
});
