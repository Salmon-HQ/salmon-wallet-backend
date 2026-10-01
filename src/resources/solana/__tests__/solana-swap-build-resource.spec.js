'use strict';

jest.mock('../../../services/solana/solana-ft-service', () => ({ getByMints: jest.fn() }));
jest.mock('../../../services/shared/coingecko-service', () => ({ getTokenPrices: jest.fn() }));

const tokenService = require('../../../services/solana/solana-ft-service');
const coingecko = require('../../../services/shared/coingecko-service');
const decorate = require('../solana-swap-build-resource');

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const context = { locals: { network: { id: 'solana-mainnet' } } };

const build = () => ({
  provider: { id: '0x', displayName: '0x', attribution: 'Powered by 0x' },
  providerRequestId: 'zid-1',
  transaction: 'AQID',
  expiresAt: '2026-09-10T20:00:00.000Z',
  inputMint: USDC,
  outputMint: SOL,
  amountIn: '100000000',
  amountOut: '990000000',
  minAmountOut: '980000000',
  slippageBps: 50,
  priorityFeeMicroLamports: 1000,
  computeUnitLimit: 155822,
  routePlan: [
    { dex_label: 'Raydium', ppb: 600000000 },
    { dex_label: 'Orca', ppb: 1000000000 },
  ],
  salmonFee: { amount: '4975000', mint: SOL, side: 'output', bps: 50 },
});

describe('solana-swap-build-resource', () => {
  beforeEach(() => {
    tokenService.getByMints.mockResolvedValue([
      { id: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, icon: 'usdc.png' },
      { id: SOL, symbol: 'SOL', name: 'Solana', decimals: 9, icon: 'sol.png' },
    ]);
    coingecko.getTokenPrices.mockResolvedValue(
      new Map([
        [USDC, { usdPrice: 1 }],
        [SOL, { usdPrice: 100 }],
      ])
    );
  });

  it('shapes the public payload with hydrated tokens, USD values and fee lines', async () => {
    const resource = await decorate(build(), {}, 'k', context);

    expect(resource).toEqual({
      provider: '0x',
      providerDisplayName: '0x',
      attribution: 'Powered by 0x',
      providerRequestId: 'zid-1',
      transaction: 'AQID',
      expiresAt: '2026-09-10T20:00:00.000Z',
      input: {
        mint: USDC,
        amount: '100000000',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin',
        logo: 'usdc.png',
      },
      output: {
        mint: SOL,
        amount: '990000000',
        minAmount: '980000000',
        decimals: 9,
        symbol: 'SOL',
        name: 'Solana',
        logo: 'sol.png',
      },
      route: [
        { label: 'Raydium', percent: 60 },
        { label: 'Orca', percent: 100 },
      ],
      priceImpactPct: 1,
      slippageBps: 50,
      priorityFeeMicroLamports: 1000,
      computeUnitLimit: 155822,
      inUsdValue: 100,
      outUsdValue: 99,
      salmonFee: {
        amount: '4975000',
        mint: SOL,
        side: 'output',
        bps: 50,
        decimals: 9,
        symbol: 'SOL',
      },
      routeFee: null,
    });
    expect(tokenService.getByMints).toHaveBeenCalledWith([USDC, SOL], context.locals);
  });

  it('degrades USD fields to null when prices are unavailable, keeping the transaction', async () => {
    coingecko.getTokenPrices.mockRejectedValue(new Error('prices down'));

    const resource = await decorate(build(), {}, 'k', context);

    expect(resource.transaction).toBe('AQID');
    expect(resource.inUsdValue).toBeNull();
    expect(resource.outUsdValue).toBeNull();
    expect(resource.priceImpactPct).toBeNull();
  });

  it('hydrates an input-side fee from the input token', async () => {
    const resource = await decorate(
      { ...build(), salmonFee: { amount: '500000', mint: USDC, side: 'input', bps: 50 } },
      {},
      'k',
      context
    );
    expect(resource.salmonFee).toEqual({
      amount: '500000',
      mint: USDC,
      side: 'input',
      bps: 50,
      decimals: 6,
      symbol: 'USDC',
    });
  });

  it('keeps salmonFee null when no fee was applied', async () => {
    const resource = await decorate({ ...build(), salmonFee: null }, {}, 'k', context);
    expect(resource.salmonFee).toBeNull();
  });
});
