'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../../../infrastructure/rate-limiting/zeroex-rate-limiter', () => ({
  rateLimiter: { waitAndConsume: jest.fn().mockResolvedValue(undefined) },
  withRetry: jest.fn((fn) => fn()),
}));

const http = require('axios');
const { PublicKey } = require('@solana/web3.js');
const { requestSwapInstructions, ZEROEX_NATIVE_SOL } = require('../zeroex-swap-provider');
const { SolanaSwapNoRouteError } = require('../solana-swap-errors');

const TAKER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const SETTLER = 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m';

const bytes = (base58) => Array.from(new PublicKey(base58).toBytes());

const zeroexResponse = () => ({
  address_lookup_tables: ['AddressLookupTab1e1111111111111111111111111'],
  amount_out: 623000000,
  min_amount_out: 620000000,
  instructions: [
    {
      program_id: bytes(SETTLER),
      accounts: [
        { pubkey: bytes(TAKER), is_signer: true, is_writable: true },
        { pubkey: bytes(USDC), is_signer: false, is_writable: false },
      ],
      data: [1, 2, 3],
    },
  ],
  route_plan: [
    {
      amount_in: '1000000',
      amount_out: '623000000',
      dex_address: 'x',
      dex_label: 'Raydium',
      dex_program_id: 'y',
      ppb: 1000000000,
      token_in: USDC,
      token_out: SOL,
    },
  ],
  zid: '0xabc',
});

describe('zeroex-swap-provider', () => {
  beforeEach(() => {
    process.env.ZEROEX_API_KEY = 'test-key';
    http.post.mockReset();
  });

  it('posts the snake_case body with the fee in ppm and decodes instructions', async () => {
    http.post.mockResolvedValue({ data: zeroexResponse() });

    const result = await requestSwapInstructions({
      inputMint: USDC,
      outputMint: SOL,
      amount: '1000000',
      taker: TAKER,
      slippageBps: 50,
      fee: { recipient: 'FeeRecipient111111111111111111111111111111', bps: 50 },
      reserveBytes: 52,
    });

    const [url, body, config] = http.post.mock.calls[0];
    expect(url).toMatch(/\/swap-instructions$/);
    expect(body).toEqual({
      token_in: USDC,
      token_out: ZEROEX_NATIVE_SOL, // SOL_ADDRESS (WSOL mint) → 0x native-SOL sentinel
      amount_in: 1000000,
      taker: TAKER,
      slippage_bps: 50,
      reserve_transaction_bytes: 52,
      swap_fee_ppm: '5000',
      swap_fee_recipient: 'FeeRecipient111111111111111111111111111111',
      swap_fee_side: 'buy',
    });
    expect(config.headers['0x-api-key']).toBe('test-key');

    expect(result.amountOut).toBe('623000000');
    expect(result.minAmountOut).toBe('620000000');
    expect(result.zid).toBe('0xabc');
    expect(result.lookupTableAddresses).toEqual(['AddressLookupTab1e1111111111111111111111111']);
    expect(result.instructions).toHaveLength(1);
    const [ix] = result.instructions;
    expect(ix.programId.toBase58()).toBe(SETTLER);
    expect(ix.keys[0]).toMatchObject({ isSigner: true, isWritable: true });
    expect(ix.keys[0].pubkey.toBase58()).toBe(TAKER);
    expect(Array.from(ix.data)).toEqual([1, 2, 3]);
  });

  it('omits every fee field when no fee is configured', async () => {
    http.post.mockResolvedValue({ data: zeroexResponse() });

    await requestSwapInstructions({
      inputMint: USDC,
      outputMint: SOL,
      amount: '1',
      taker: TAKER,
      slippageBps: 50,
      fee: null,
      reserveBytes: 0,
    });

    const body = http.post.mock.calls[0][1];
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['swap_fee_ppm']));
  });

  it("maps a 0x 400 onto 404 no_route carrying the provider's reason", async () => {
    http.post.mockRejectedValue({
      response: { status: 400, data: { code: 'NO_ROUTE', error: 'insufficient liquidity' } },
    });

    await expect(
      requestSwapInstructions({
        inputMint: USDC,
        outputMint: SOL,
        amount: '1',
        taker: TAKER,
        slippageBps: 50,
        fee: null,
        reserveBytes: 0,
      })
    ).rejects.toMatchObject({
      constructor: SolanaSwapNoRouteError,
      statusCode: 404,
      errorCode: 'no_route',
      message: 'insufficient liquidity',
    });
  });

  it('maps a 0x 422 (TOKEN_NOT_FOUND) onto 404 no_route as well', async () => {
    http.post.mockRejectedValue({
      response: { status: 422, data: { code: 'TOKEN_NOT_FOUND', error: 'Token not found' } },
    });

    await expect(
      requestSwapInstructions({
        inputMint: USDC,
        outputMint: SOL,
        amount: '1',
        taker: TAKER,
        slippageBps: 50,
        fee: null,
        reserveBytes: 0,
      })
    ).rejects.toMatchObject({ statusCode: 404, errorCode: 'no_route', message: 'Token not found' });
  });

  it('maps a 0x 403 (taker screened) onto 403 wallet_restricted', async () => {
    http.post.mockRejectedValue({
      response: {
        status: 403,
        data: { code: 'TAKER_NOT_AUTHORIZED_FOR_TRADE', error: 'Taker not authorized' },
      },
    });

    await expect(
      requestSwapInstructions({
        inputMint: USDC,
        outputMint: SOL,
        amount: '1',
        taker: TAKER,
        slippageBps: 50,
        fee: null,
        reserveBytes: 0,
      })
    ).rejects.toMatchObject({ statusCode: 403, errorCode: 'wallet_restricted' });
  });

  it('answers 503 upstream_rate_limited when 0x keeps returning 429', async () => {
    http.post.mockRejectedValue({
      response: { status: 429, data: { message: 'Rate limit exceeded.' } },
    });

    await expect(
      requestSwapInstructions({
        inputMint: USDC,
        outputMint: SOL,
        amount: '1',
        taker: TAKER,
        slippageBps: 50,
        fee: null,
        reserveBytes: 0,
      })
    ).rejects.toMatchObject({ statusCode: 503, errorCode: 'upstream_rate_limited' });
  });

  it('lets a 0x 5xx/401 propagate untouched (our fault, not the caller)', async () => {
    const upstream = { response: { status: 401, data: { message: 'Unauthorized' } } };
    http.post.mockRejectedValue(upstream);

    await expect(
      requestSwapInstructions({
        inputMint: USDC,
        outputMint: SOL,
        amount: '1',
        taker: TAKER,
        slippageBps: 50,
        fee: null,
        reserveBytes: 0,
      })
    ).rejects.toBe(upstream);
  });
});
