'use strict';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((name, fn) => fn({ timeout: 10000, signal: undefined })),
}));

const http = require('axios');
const { ComputeBudgetProgram } = require('@solana/web3.js');
const { providerCall } = require('../../../../infrastructure/providers/provider-client');
const {
  requestSwapInstructions,
  isConfigured,
  PROVIDER,
  FEE,
} = require('../jupiter-swap-provider');
const noFee = require('./fixtures/jupiter-build-usdc-sol.json');
const withFee = require('./fixtures/jupiter-build-sol-usdc-fee.json');

const TAKER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const FEE_ATA = 'DjqW361S9LFPpgwTbjuVa993ZGsk2U7AeXpiptNDpcBq';

const request = (overrides = {}) =>
  requestSwapInstructions({
    inputMint: USDC,
    outputMint: SOL,
    amount: '1000000',
    taker: TAKER,
    slippageBps: 50,
    fee: null,
    ...overrides,
  });

describe('jupiter-swap-provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JUPITER_API_KEY = 'test-key';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.JUPITER_API_KEY;
    jest.restoreAllMocks();
  });

  it('is configured only with a key', () => {
    expect(isConfigured()).toBe(true);
    delete process.env.JUPITER_API_KEY;
    expect(isConfigured()).toBe(false);
    expect(PROVIDER).toEqual({
      id: 'jupiter',
      displayName: 'Jupiter',
      attribution: 'Powered by Jupiter',
    });
    expect(FEE).toEqual({ sides: ['buy'], nativeSolAsWallet: false });
  });

  it('calls /build with the key, flattens the instruction groups and drops the compute budget', async () => {
    http.get.mockResolvedValue({ data: noFee });

    const result = await request();

    expect(providerCall).toHaveBeenCalledWith('jupiter', expect.any(Function), expect.any(Object));
    const [url, config] = http.get.mock.calls[0];
    expect(url).toBe('https://api.jup.ag/swap/v2/build');
    expect(config.headers).toEqual({ 'x-api-key': 'test-key' });
    expect(config.params).toEqual({
      inputMint: USDC,
      outputMint: SOL,
      amount: '1000000',
      taker: TAKER,
      slippageBps: 50,
    });

    const expected = noFee.setupInstructions.length + 1 + 1 + noFee.otherInstructions.length;
    expect(result.instructions).toHaveLength(expected);
    const programs = result.instructions.map((ix) => ix.programId.toBase58());
    expect(programs).not.toContain(ComputeBudgetProgram.programId.toBase58());
    expect(programs).toContain(noFee.swapInstruction.programId);
    const swap = result.instructions.find(
      (ix) => ix.programId.toBase58() === noFee.swapInstruction.programId
    );
    expect(swap.keys[0]).toMatchObject({ isSigner: true, isWritable: false });
    expect(swap.keys[0].pubkey.toBase58()).toBe(TAKER);
    expect(swap.data).toEqual(Buffer.from(noFee.swapInstruction.data, 'base64'));

    expect(result.lookupTableAddresses).toEqual(Object.keys(noFee.addressesByLookupTableAddress));
    expect(result.amountOut).toBe(noFee.outAmount);
    expect(result.minAmountOut).toBe(noFee.otherAmountThreshold);
    expect(result.routePlan).toEqual([{ label: 'Kipseli', percent: 100 }]);
    expect(result.providerRequestId).toBeNull();
    expect(result.routeFee).toBeNull();
  });

  it('sends the platform fee and the fee account is referenced by the swap instruction', async () => {
    http.get.mockResolvedValue({ data: withFee });

    const result = await request({
      inputMint: SOL,
      outputMint: USDC,
      amount: '10000000',
      fee: { recipient: FEE_ATA, bps: 50, side: 'buy' },
    });

    expect(http.get.mock.calls[0][1].params).toMatchObject({
      platformFeeBps: 50,
      feeAccount: FEE_ATA,
    });
    const referenced = result.instructions.some((ix) =>
      ix.keys.some((k) => k.pubkey.toBase58() === FEE_ATA)
    );
    expect(referenced).toBe(true);
  });

  it("maps a 400 'No routes found' onto 404 no_route carrying Jupiter's reason", async () => {
    http.get.mockRejectedValue({ response: { status: 400, data: { error: 'No routes found' } } });
    await expect(request()).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'no_route',
      message: 'No routes found',
    });
  });

  it('maps a rejected fee account onto 500 swap_misconfigured', async () => {
    http.get.mockRejectedValue({
      response: { status: 400, data: { error: 'Invalid feeAccount' } },
    });
    await expect(request()).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'swap_misconfigured',
    });
    expect(console.error).toHaveBeenCalledWith(
      '[SWAP_MISCONFIGURED] Jupiter rejected our own request parameters',
      expect.any(Object)
    );
  });

  it('answers 503 upstream_rate_limited on a 429 and lets 401/5xx propagate', async () => {
    http.get.mockRejectedValue({ response: { status: 429, data: {} } });
    await expect(request()).rejects.toMatchObject({ errorCode: 'upstream_rate_limited' });

    const unauthorized = { response: { status: 401, data: { message: 'bad key' } } };
    http.get.mockRejectedValue(unauthorized);
    await expect(request()).rejects.toBe(unauthorized);
  });
});
