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
  test('aggregator SWAP populates a single-hop swapRoute aligned with inputs/outputs', async () => {
    const heliusTx = {
      signature: 'sig-swap',
      timestamp: 1700000000,
      type: 'SWAP',
      source: 'AGGREGATOR',
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
    expect(hop.dex).toBe('AGGREGATOR');

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

  test('a 0x multi-hop swap nets the intermediate token out of the legs', async () => {
    // Shape of a real mainnet tx: USDC → USD1 → SOL through the 0x settler,
    // labelled INITIALIZE_ACCOUNT by the provider, ui amounts, no decimals.
    const USD1_MINT = 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB';
    const SETTLER = 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m';
    const transfer = (from, to, mint, tokenAmount) => ({
      fromUserAccount: from,
      toUserAccount: to,
      mint,
      tokenAmount,
      tokenStandard: 'Fungible',
    });
    const heliusTx = {
      signature: 'sig-0x',
      timestamp: 1789139570,
      type: 'INITIALIZE_ACCOUNT',
      source: 'ASSOCIATED_TOKEN_PROGRAM',
      feePayer: USER,
      instructions: [{ programId: SETTLER }],
      tokenTransfers: [
        transfer(USER, POOL, USDC_MINT, 1.093481),
        transfer(POOL, USER, USD1_MINT, 1.093657),
        transfer(USER, 'other-pool', USDC_MINT, 0.006519),
        transfer('other-pool', USER, SOL_MINT, 0.000063301),
        transfer(USER, POOL, USD1_MINT, 1.093657),
        transfer(POOL, USER, SOL_MINT, 0.010612719),
      ],
      nativeTransfers: [{ fromUserAccount: USER, toUserAccount: 'fee-wallet', amount: 53380 }],
    };
    const tokens = new Map([
      [USDC_MINT, { address: USDC_MINT, symbol: 'USDC', decimals: 6 }],
      [USD1_MINT, { address: USD1_MINT, symbol: 'USD1', decimals: 6 }],
      [SOL_MINT, { address: SOL_MINT, symbol: 'SOL', decimals: 9 }],
    ]);

    const item = await transformTransaction(heliusTx, USER, tokens);

    expect(item.type).toBe(SWAP);
    expect(item.source).toBe('AGGREGATOR');
    expect(item.outputs).toEqual([
      expect.objectContaining({ contract: USDC_MINT, symbol: 'USDC', amount: '1100000' }),
    ]);
    expect(item.inputs).toEqual([
      expect.objectContaining({ contract: SOL_MINT, symbol: 'SOL', amount: '10676020' }),
    ]);
    expect(item.swapRoute.hops[0]).toMatchObject({
      dex: 'AGGREGATOR',
      inputToken: { symbol: 'USDC', amount: '1100000' },
      outputToken: { symbol: 'SOL', amount: '10676020' },
    });
  });

  test('a wallet-to-wallet swap by mint mix keeps the native SOL leg and never borrows the counterparty transfer', async () => {
    // Shape of a real mainnet tx: a counterparty sends USDC to the user, the
    // user sends SOL natively; the provider labels it TRANSFER.
    const COUNTERPARTY = '6UWsi9WKQbE5jLxLcycfr5NZ1DQGVNKUCkW1pzUaRVCE';
    const heliusTx = {
      signature: 'sig-p2p',
      timestamp: 1756000000,
      type: 'TRANSFER',
      source: 'SYSTEM_PROGRAM',
      feePayer: COUNTERPARTY,
      instructions: [{ programId: '11111111111111111111111111111111' }],
      tokenTransfers: [
        {
          fromUserAccount: COUNTERPARTY,
          toUserAccount: USER,
          mint: USDC_MINT,
          tokenAmount: 2.863933,
          tokenStandard: 'Fungible',
        },
      ],
      nativeTransfers: [
        { fromUserAccount: USER, toUserAccount: 'merchant', amount: 150000 },
        { fromUserAccount: USER, toUserAccount: 'merchant', amount: 29850000 },
      ],
    };
    const tokens = new Map([[USDC_MINT, { address: USDC_MINT, symbol: 'USDC', decimals: 6 }]]);

    const item = await transformTransaction(heliusTx, USER, tokens);

    expect(item.type).toBe(SWAP);
    expect(item.inputs).toEqual([
      expect.objectContaining({ contract: USDC_MINT, symbol: 'USDC', amount: '2863933' }),
    ]);
    expect(item.outputs).toEqual([
      expect.objectContaining({ contract: SOL_MINT, symbol: 'SOL', amount: '30000000' }),
    ]);
    expect(item.swapRoute.hops[0]).toMatchObject({
      inputToken: { symbol: 'SOL', amount: '30000000' },
      outputToken: { symbol: 'USDC', amount: '2863933' },
    });
  });
});
