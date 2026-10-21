'use strict';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((name, fn) => fn({ timeout: 10000, signal: undefined })),
}));

const http = require('axios');
const { ComputeBudgetProgram, PublicKey, SystemProgram } = require('@solana/web3.js');
const {
  AuthorityType,
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
} = require('@solana/spl-token');
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
// The taker's own accounts in the fixtures (associated token accounts under SPL Token).
const TAKER_WSOL = 'HXkHFMCRQP6pw66QEGBqVsduqUQdSyrrrq82S7Rffsms';
const TAKER_USDC = '9SHQTA66Ekh7ZgMnKWsjxXk6DwXku8przs45E8bcEe38';
const STRANGER = new PublicKey(Buffer.alloc(32, 7));

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

/** A web3.js instruction in Jupiter's wire format. */
const toWire = (ix) => ({
  programId: ix.programId.toBase58(),
  accounts: ix.keys.map((k) => ({
    pubkey: k.pubkey.toBase58(),
    isSigner: k.isSigner,
    isWritable: k.isWritable,
  })),
  data: Buffer.from(ix.data).toString('base64'),
});

/** The fee fixture (SOL → USDC: wrap, swap, unwrap) with `extra` appended to `otherInstructions`. */
const withOther = (...extra) => ({ ...withFee, otherInstructions: extra.map(toWire) });

const requestWithFee = () =>
  request({
    inputMint: SOL,
    outputMint: USDC,
    amount: '10000000',
    fee: { recipient: FEE_ATA, bps: 50, side: 'buy' },
  });

const expectRefused = async (data) => {
  http.get.mockResolvedValue({ data });
  await expect(requestWithFee()).rejects.toMatchObject({
    statusCode: 502,
    errorCode: 'provider_bad_response',
  });
};

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
      displayName: 'Metis',
      attribution: 'Powered by Metis (Jupiter)',
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

  it.each([
    ['No routes found', 404, 'no_route'],
    ['inputMint cannot be same as outputMint', 400, 'invalid_parameter'],
    ['Invalid inputMint', 500, 'swap_misconfigured'],
    ['Invalid outputMint', 500, 'swap_misconfigured'],
    ['Invalid taker', 500, 'swap_misconfigured'],
    ['Invalid amount', 500, 'swap_misconfigured'],
    ['Invalid feeAccount', 500, 'swap_misconfigured'],
    ['feeAccount is required when platformFeeBps is positive', 500, 'swap_misconfigured'],
    ['Something new', 404, 'no_route'],
  ])(
    "maps a 400 '%s' onto %i %s, Jupiter's text in the message",
    async (text, statusCode, errorCode) => {
      http.get.mockRejectedValue({ response: { status: 400, data: { error: text } } });
      await expect(request()).rejects.toMatchObject({ statusCode, errorCode, message: text });
      if (statusCode === 500) {
        expect(console.error).toHaveBeenCalledWith(
          '[SWAP_MISCONFIGURED] Jupiter rejected our own request parameters',
          expect.any(Object)
        );
      }
    }
  );

  it('treats a Zod validation error (our request shape) as our own misconfiguration, naming the field', async () => {
    http.get.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            name: 'ZodError',
            issues: [
              { code: 'too_big', path: ['slippageBps'], message: 'Number must be <= 10000' },
            ],
          },
        },
      },
    });
    await expect(request()).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'swap_misconfigured',
      message: 'slippageBps: Number must be <= 10000',
    });
  });

  it('maps a 404 and a 422 onto no_route too', async () => {
    for (const status of [404, 422]) {
      http.get.mockRejectedValue({ response: { status, data: { message: 'gone' } } });
      await expect(request()).rejects.toMatchObject({ errorCode: 'no_route', message: 'gone' });
    }
  });

  it('answers 503 upstream_rate_limited on a 429 and lets a 5xx propagate', async () => {
    http.get.mockRejectedValue({ response: { status: 429, data: {} } });
    await expect(request()).rejects.toMatchObject({ errorCode: 'upstream_rate_limited' });

    const outage = { response: { status: 502, data: { message: 'bad gateway' } } };
    http.get.mockRejectedValue(outage);
    await expect(request()).rejects.toBe(outage);
  });

  it('refuses a 200 without a swap instruction or amounts as a provider defect, never signable bytes', async () => {
    for (const data of [
      { ...noFee, swapInstruction: undefined },
      { ...noFee, outAmount: undefined },
      { ...noFee, otherAmountThreshold: 'abc' },
      {},
    ]) {
      http.get.mockResolvedValue({ data });
      await expect(request()).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'provider_bad_response',
      });
    }
    expect(console.error).toHaveBeenCalledWith('[SWAP_PROVIDER_BAD_RESPONSE]', {
      provider: 'jupiter',
    });
  });

  it('maps a 401/403 onto 503 and never rethrows the error that carries our key', async () => {
    for (const status of [401, 403]) {
      http.get.mockRejectedValue({
        response: { status, data: { message: 'Unauthorized' } },
        config: { headers: { 'x-api-key': 'test-key' } },
      });
      await expect(request()).rejects.toMatchObject({
        statusCode: 503,
        errorCode: 'upstream_unavailable',
      });
    }
    expect(console.error).toHaveBeenCalledWith('[SWAP_PROVIDER_AUTH]', {
      provider: 'jupiter',
      status: 401,
    });
  });

  describe("refuses a build that does more than the taker's own swap", () => {
    const taker = new PublicKey(TAKER);
    const usdcAta = new PublicKey(TAKER_USDC);
    const wsolAta = new PublicKey(TAKER_WSOL);

    it.each([
      [
        'a SOL transfer to a foreign account',
        () =>
          withOther(SystemProgram.transfer({ fromPubkey: taker, toPubkey: STRANGER, lamports: 1 })),
      ],
      [
        'an Assign of the wallet to another program',
        () => withOther(SystemProgram.assign({ accountPubkey: taker, programId: STRANGER })),
      ],
      [
        'an SPL Approve to a foreign delegate',
        () => withOther(createApproveInstruction(usdcAta, STRANGER, taker, 1n)),
      ],
      [
        'an SPL SetAuthority handing the token account away',
        () =>
          withOther(
            createSetAuthorityInstruction(usdcAta, taker, AuthorityType.AccountOwner, STRANGER)
          ),
      ],
      [
        'a CloseAccount paying the rent to a foreign account',
        () => ({
          ...withFee,
          cleanupInstruction: toWire(createCloseAccountInstruction(wsolAta, STRANGER, taker)),
        }),
      ],
      [
        "an account created for someone else at the taker's expense",
        () =>
          withOther(
            createAssociatedTokenAccountIdempotentInstruction(
              taker,
              new PublicKey(FEE_ATA),
              STRANGER,
              new PublicKey(USDC)
            )
          ),
      ],
      [
        'a compute-budget instruction (the builder sets its own)',
        () => withOther(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10n ** 12n })),
      ],
      [
        'a second Jupiter instruction',
        () => ({ ...withFee, otherInstructions: [withFee.swapInstruction] }),
      ],
    ])('refuses %s with 502 provider_bad_response', async (_, tampered) => {
      await expectRefused(tampered());
      expect(console.error).toHaveBeenCalledWith(
        '[SWAP_PROVIDER_BAD_RESPONSE]',
        expect.objectContaining({ provider: 'jupiter', reason: expect.any(String) })
      );
    });
  });

  describe('binds the route_v2 call to the taker and to the amounts it reports', () => {
    const strangerUsdc = getAssociatedTokenAddressSync(
      new PublicKey(USDC),
      STRANGER,
      true
    ).toBase58();

    /**
     * The fee fixture with its router call edited. route_v2 data: 8-byte
     * discriminator, in u64 @8, quoted out u64 @16, slippage u16 @24,
     * platform fee u16 @26; accounts: 0 authority, 1 source, 2 destination,
     * 7 destination override (the Jupiter program id when empty).
     */
    const routeWith = (edit) => {
      const data = Buffer.from(withFee.swapInstruction.data, 'base64');
      const accounts = withFee.swapInstruction.accounts.map((account) => ({ ...account }));
      const edited = edit({ data, accounts }) || data;
      return {
        ...withFee,
        swapInstruction: { ...withFee.swapInstruction, accounts, data: edited.toString('base64') },
      };
    };

    it.each([
      [
        'pays the output to a foreign account',
        () =>
          routeWith(({ accounts }) => {
            accounts[2].pubkey = strangerUsdc;
          }),
      ],
      [
        'redirects the output through the override slot',
        () =>
          routeWith(({ accounts }) => {
            accounts[7].pubkey = strangerUsdc;
          }),
      ],
      [
        'swaps under another authority',
        () =>
          routeWith(({ accounts }) => {
            accounts[0].pubkey = STRANGER.toBase58();
          }),
      ],
      [
        'spends a token other than the input',
        () =>
          routeWith(({ accounts }) => {
            accounts[1].pubkey = TAKER_USDC;
          }),
      ],
      ['is not route_v2', () => routeWith(({ data }) => Buffer.from([0, ...data.subarray(1)]))],
      ['is truncated', () => routeWith(({ data }) => data.subarray(0, 20))],
      [
        'spends more than the requested amount',
        () => routeWith(({ data }) => void data.writeBigUInt64LE(20000000n, 8)),
      ],
      [
        'allows more slippage than requested',
        () => routeWith(({ data }) => void data.writeUInt16LE(10000, 24)),
      ],
      [
        'takes another platform fee than Salmon asked for',
        () => routeWith(({ data }) => void data.writeUInt16LE(500, 26)),
      ],
      ['reports an output the call does not quote', () => ({ ...withFee, outAmount: '2000000' })],
      [
        'reports a minimum the call does not enforce',
        () => ({ ...withFee, otherAmountThreshold: '1170000' }),
      ],
    ])('refuses a router call that %s', async (_, tampered) => {
      await expectRefused(tampered());
    });

    it('refuses a platform fee when Salmon asked for none', async () => {
      http.get.mockResolvedValue({ data: withFee });
      await expect(
        request({ inputMint: SOL, outputMint: USDC, amount: '10000000' })
      ).rejects.toMatchObject({ statusCode: 502, errorCode: 'provider_bad_response' });
    });

    it('accepts the minimum rounded down as well as up (1173138 at 50 bps = 1167272.31)', async () => {
      http.get.mockResolvedValue({ data: { ...withFee, otherAmountThreshold: '1167272' } });
      await expect(requestWithFee()).resolves.toMatchObject({
        amountOut: '1173138',
        minAmountOut: '1167272',
      });
    });
  });
});
