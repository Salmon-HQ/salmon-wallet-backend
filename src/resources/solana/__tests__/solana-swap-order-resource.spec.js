'use strict';

const swapOrderResource = require('../solana-swap-order-resource');
const jupiterTokenService = require('../../../services/solana/jupiter-token-service');

jest.mock('../../../services/solana/jupiter-token-service');

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';

const tokens = [
  { id: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, icon: 'usdc.png' },
  { id: SOL, symbol: 'SOL', name: 'Solana', decimals: 9, icon: 'sol.png' },
];

const baseOrder = {
  transaction: 'BASE64_TX',
  requestId: 'req-1',
  router: 'metis',
  priceImpact: 0.005,
  feeBps: 50,
  prioritizationFeeLamports: 4200,
  rentFeeLamports: 0,
  gasless: false,
  slippageBps: 22,
  swapMode: 'ExactIn',
  otherAmountThreshold: '12263810',
  inUsdValue: 1.09,
  outUsdValue: 1.09,
  outAmount: '12263810',
};

const ctx = { locals: {} };

beforeEach(() => {
  jest.resetAllMocks();
  jupiterTokenService.getTokensByMints.mockResolvedValue(tokens);
});

describe('solana-swap-order-resource', () => {
  it('parses Jupiter Ultra v1 routePlan with nested swapInfo', async () => {
    const order = {
      ...baseOrder,
      routePlan: [
        {
          swapInfo: {
            ammKey: 'amm-1',
            label: 'Raydium CLMM',
            inputMint: USDC,
            outputMint: SOL,
            inAmount: '1100000',
            outAmount: '12263810',
          },
          percent: 100,
        },
      ],
    };

    const result = await swapOrderResource(order, undefined, undefined, ctx);

    expect(result.routeNames).toEqual(['Raydium CLMM']);
    expect(result.routeSymbols).toEqual(['USDC', 'SOL']);
    expect(result.input.contract).toBe(USDC);
    expect(result.input.amount).toBe('1100000');
    expect(result.output.contract).toBe(SOL);
    expect(result.output.amount).toBe('12263810');
    expect(result.custom.router).toBe('metis');
  });

  it('parses legacy V6 routePlan with flat fields (backward compatible)', async () => {
    const order = {
      ...baseOrder,
      routePlan: [
        {
          label: 'Whirlpool',
          inputMint: USDC,
          outputMint: SOL,
          inAmount: '1100000',
          outAmount: '12263810',
        },
      ],
    };

    const result = await swapOrderResource(order, undefined, undefined, ctx);

    expect(result.routeNames).toEqual(['Whirlpool']);
    expect(result.input.contract).toBe(USDC);
    expect(result.output.contract).toBe(SOL);
  });

  it('handles multi-hop Ultra routePlan and aggregates intermediate mints', async () => {
    const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
    jupiterTokenService.getTokensByMints.mockResolvedValue([
      { id: USDC, symbol: 'USDC', decimals: 6 },
      { id: USDT, symbol: 'USDT', decimals: 6 },
      { id: SOL, symbol: 'SOL', decimals: 9 },
    ]);

    const order = {
      ...baseOrder,
      routePlan: [
        {
          swapInfo: { label: 'Orca', inputMint: USDC, outputMint: USDT, inAmount: '1100000' },
          percent: 100,
        },
        {
          swapInfo: { label: 'Raydium', inputMint: USDT, outputMint: SOL, inAmount: '1099000' },
          percent: 100,
        },
      ],
    };

    const result = await swapOrderResource(order, undefined, undefined, ctx);

    expect(result.routeNames).toEqual(['Orca', 'Raydium']);
    expect(result.routeSymbols).toEqual(['USDC', 'USDT', 'SOL']);
  });

  it('denominates the fee in the input token, not in SOL', async () => {
    const order = {
      ...baseOrder,
      feeBps: 50,
      routePlan: [
        {
          swapInfo: { label: 'Orca', inputMint: USDC, outputMint: SOL, inAmount: '1100000' },
          percent: 100,
        },
      ],
    };

    const result = await swapOrderResource(order, undefined, undefined, ctx);

    // 1_100_000 base units of USDC * 50 bps = 5_500 base units of USDC,
    // labelled with USDC's own decimals/symbol. The old implementation
    // multiplied by a USD price and labelled the result SOL/9-decimals.
    expect(result.fee).toEqual({
      amount: 5500,
      decimals: 6,
      symbol: 'USDC',
      percent: 0.5,
    });
  });

  it('keeps SOL inputs correct too', async () => {
    const order = {
      ...baseOrder,
      feeBps: 50,
      routePlan: [
        {
          swapInfo: { label: 'Orca', inputMint: SOL, outputMint: USDC, inAmount: '1000000000' },
          percent: 100,
        },
      ],
    };

    const result = await swapOrderResource(order, undefined, undefined, ctx);

    expect(result.fee).toEqual({
      amount: 5000000,
      decimals: 9,
      symbol: 'SOL',
      percent: 0.5,
    });
  });

  it('returns a null fee when the order carries no feeBps', async () => {
    const order = {
      ...baseOrder,
      feeBps: undefined,
      routePlan: [
        {
          swapInfo: { label: 'Orca', inputMint: USDC, outputMint: SOL, inAmount: '1100000' },
          percent: 100,
        },
      ],
    };

    const result = await swapOrderResource(order, undefined, undefined, ctx);

    expect(result.fee).toBeNull();
  });

  it('returns a null fee when the route carries no input amount', async () => {
    const order = { ...baseOrder, feeBps: 50, routePlan: [] };

    const result = await swapOrderResource(order, undefined, undefined, ctx);

    expect(result.fee).toBeNull();
  });

  describe('input amount source', () => {
    it('reports the order amount, not the first leg, when the router deducts the fee first', async () => {
      // Observed live against Jupiter: a 100000000 order routed with the
      // platform fee already taken out, so the first leg carried 99500000.
      const resource = await swapOrderResource(
        {
          transaction: 'tx',
          requestId: 'req',
          inAmount: '100000000',
          outAmount: '9078222',
          feeBps: 50,
          routePlan: [
            {
              swapInfo: {
                inputMint: 'So11111111111111111111111111111111111111112',
                outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                inAmount: '99500000',
                outAmount: '9078222',
                label: 'BisonFi',
              },
            },
          ],
        },
        undefined,
        undefined,
        ctx
      );

      expect(resource.input.amount).toBe('100000000');
      expect(resource.fee.amount).toBe(500000);
    });

    it('reports the order amount when the route splits at the first hop', async () => {
      const resource = await swapOrderResource(
        {
          transaction: 'tx',
          requestId: 'req',
          inAmount: '100000000',
          outAmount: '9000000',
          feeBps: 50,
          routePlan: [
            {
              percent: 40,
              swapInfo: {
                inputMint: 'So11111111111111111111111111111111111111112',
                outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                inAmount: '40000000',
                outAmount: '3600000',
                label: 'Whirlpool',
              },
            },
            {
              percent: 60,
              swapInfo: {
                inputMint: 'So11111111111111111111111111111111111111112',
                outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                inAmount: '60000000',
                outAmount: '5400000',
                label: 'HumidiFi',
              },
            },
          ],
        },
        undefined,
        undefined,
        ctx
      );

      expect(resource.input.amount).toBe('100000000');
      expect(resource.fee.amount).toBe(500000);
    });

    it('falls back to the first leg when the order carries no top-level amount', async () => {
      const resource = await swapOrderResource(
        {
          transaction: 'tx',
          requestId: 'req',
          outAmount: '9078222',
          feeBps: 50,
          routePlan: [
            {
              swapInfo: {
                inputMint: 'So11111111111111111111111111111111111111112',
                outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                inAmount: '100000000',
                outAmount: '9078222',
                label: 'Legacy',
              },
            },
          ],
        },
        undefined,
        undefined,
        ctx
      );

      expect(resource.input.amount).toBe('100000000');
    });
  });
});
