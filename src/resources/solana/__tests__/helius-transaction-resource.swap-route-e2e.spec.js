'use strict';

/**
 * End-to-end-ish tests for swapRoute population.
 *
 * The buildSwapRoute helper has its own focused unit spec
 * (`helius-transaction-resource.swap-route.spec.js`). This file checks the
 * integration: when transformTransaction runs against a SWAP-typed enriched
 * tx, the returned object must carry `swapRoute.hops[0]` aligned with the
 * user-pivoted inputs/outputs.
 */

const transformTransaction = require('../helius-transaction-resource');
const { SWAP } = require('../../../constants/transaction-types');

const USER = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
const POOL = 'POOLaccount22222222222222222222222222222222';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

describe('swapRoute integration', () => {
  test('Jupiter SWAP populates a single-hop swapRoute aligned with inputs/outputs', async () => {
    const heliusTx = {
      signature: 'sig-swap',
      timestamp: 1700000000,
      type: 'SWAP',
      source: 'JUPITER',
      feePayer: USER,
      instructions: [{ programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' }],
      tokenTransfers: [
        // user sends USDC into the pool
        {
          fromUserAccount: USER,
          toUserAccount: POOL,
          mint: USDC_MINT,
          tokenAmount: '1000000',
          decimals: 6,
        },
        // pool sends SOL to user
        {
          fromUserAccount: POOL,
          toUserAccount: USER,
          mint: SOL_MINT,
          tokenAmount: '500000000',
          decimals: 9,
        },
      ],
      nativeTransfers: [],
    };

    const result = await transformTransaction(heliusTx, USER, []);

    expect(result.type).toBe(SWAP);
    expect(result.swapRoute).toBeDefined();
    expect(result.swapRoute.hops).toHaveLength(1);

    const [hop] = result.swapRoute.hops;
    // Hop's `inputToken` is what the user sent OUT (USDC). Note: `outputs`
    // in the resource layer holds tokens leaving the user's wallet, so the
    // hop's `inputToken` reads from `outputs[0]`.
    expect(hop.inputToken.amount).toBe('1000000');
    expect(hop.inputToken.decimals).toBe(6);
    // Hop's `outputToken` is what the user received (SOL).
    expect(hop.outputToken.amount).toBe('500000000');
    expect(hop.outputToken.decimals).toBe(9);
    expect(hop.dex).toBe('JUPITER');

    expect(result.swapRoute.inputAmount).toBe('1000000');
    expect(result.swapRoute.outputAmount).toBe('500000000');

    // Conversion rate object populated when amounts present
    expect(result.swapRoute.conversionRate).toBeDefined();
    expect(typeof result.swapRoute.conversionRate.rate).toBe('string');
    expect(result.swapRoute.conversionRate.rate).toMatch(/^\d+\.\d{6}$/);
  });

  test('non-SWAP transaction has swapRoute=undefined', async () => {
    const heliusTx = {
      signature: 'sig-send',
      type: 'TRANSFER',
      timestamp: 1,
      feePayer: USER,
      tokenTransfers: [
        {
          fromUserAccount: USER,
          toUserAccount: 'other',
          mint: USDC_MINT,
          tokenAmount: '5',
          decimals: 6,
        },
      ],
      nativeTransfers: [],
    };
    const result = await transformTransaction(heliusTx, USER, []);
    expect(result.swapRoute).toBeUndefined();
  });

  test('SWAP without resolvable pair returns null swapRoute', async () => {
    // No outgoing or no incoming tokens — buildSwapRoute returns null.
    const heliusTx = {
      signature: 'sig-swap-bad',
      type: 'SWAP',
      timestamp: 1,
      feePayer: USER,
      instructions: [{ programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' }],
      tokenTransfers: [],
      nativeTransfers: [],
    };
    const result = await transformTransaction(heliusTx, USER, []);
    expect(result.type).toBe(SWAP);
    expect(result.swapRoute).toBeNull();
  });
});
