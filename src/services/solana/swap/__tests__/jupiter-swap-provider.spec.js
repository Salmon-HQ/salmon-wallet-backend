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
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
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

/** `send` answers 502 provider_bad_response and logs exactly `reason`. */
const expectRefused = async (data, reason, send = requestWithFee) => {
  http.get.mockResolvedValue({ data });
  await expect(send()).rejects.toMatchObject({
    statusCode: 502,
    errorCode: 'provider_bad_response',
  });
  expect(console.error).toHaveBeenCalledWith('[SWAP_PROVIDER_BAD_RESPONSE]', {
    provider: 'jupiter',
    reason,
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
      { ...noFee, setupInstructions: 'not a list' },
      { ...noFee, otherInstructions: {} },
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

  it('refuses an instruction whose account is not a public key as a provider defect', async () => {
    const accounts = noFee.swapInstruction.accounts.map((account, index) =>
      index === 3 ? { ...account, pubkey: 'not base58!' } : account
    );
    await expectRefused(
      { ...noFee, swapInstruction: { ...noFee.swapInstruction, accounts } },
      'undecodable instruction',
      () => request()
    );
  });

  it('reads only a literal true as a signer or writable flag', async () => {
    const accounts = noFee.swapInstruction.accounts.map((account, index) =>
      index === 3 ? { ...account, isSigner: 'false', isWritable: 1 } : account
    );
    http.get.mockResolvedValue({
      data: { ...noFee, swapInstruction: { ...noFee.swapInstruction, accounts } },
    });

    const result = await request();

    const swap = result.instructions.find((ix) => ix.programId.toBase58() === JUPITER);
    expect(swap.keys[3]).toMatchObject({ isSigner: false, isWritable: false });
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

    const SYSTEM = '11111111111111111111111111111111';
    const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    const wrap = (lamports) =>
      SystemProgram.transfer({ fromPubkey: taker, toPubkey: wsolAta, lamports });

    it.each([
      [
        'a SOL transfer to a foreign account',
        () =>
          withOther(SystemProgram.transfer({ fromPubkey: taker, toPubkey: STRANGER, lamports: 1 })),
        `unexpected instruction 2 on ${SYSTEM}`,
      ],
      [
        'an Assign of the wallet to another program',
        () => withOther(SystemProgram.assign({ accountPubkey: taker, programId: STRANGER })),
        `unexpected instruction 1 on ${SYSTEM}`,
      ],
      [
        'an SPL Approve to a foreign delegate',
        () => withOther(createApproveInstruction(usdcAta, STRANGER, taker, 1n)),
        `unexpected instruction 4 on ${TOKEN}`,
      ],
      [
        'an SPL SetAuthority handing the token account away',
        () =>
          withOther(
            createSetAuthorityInstruction(usdcAta, taker, AuthorityType.AccountOwner, STRANGER)
          ),
        `unexpected instruction 6 on ${TOKEN}`,
      ],
      [
        'a CloseAccount paying the rent to a foreign account',
        () => ({
          ...withFee,
          cleanupInstruction: toWire(createCloseAccountInstruction(wsolAta, STRANGER, taker)),
        }),
        `unexpected instruction 9 on ${TOKEN}`,
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
        'unexpected instruction 1 on ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      ],
      [
        'a compute-budget instruction (the builder sets its own)',
        () => withOther(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10n ** 12n })),
        'unexpected instruction 3 on ComputeBudget111111111111111111111111111111',
      ],
      [
        'a second Jupiter instruction',
        () => ({ ...withFee, otherInstructions: [withFee.swapInstruction] }),
        `unexpected instruction 187 on ${JUPITER}`,
      ],
      [
        'a wrap of more SOL than the swap spends',
        () => ({
          ...withFee,
          setupInstructions: withFee.setupInstructions.map((ix) =>
            ix.programId === SYSTEM ? toWire(wrap(20000000)) : ix
          ),
        }),
        'wrap transfer amount',
      ],
      ['a second wrap', () => withOther(wrap(10000000)), 'second wrap transfer'],
    ])('refuses %s with 502 provider_bad_response', async (_, tampered, reason) => {
      await expectRefused(tampered(), reason);
    });

    const ownAtaCreate = (mint) =>
      createAssociatedTokenAccountIdempotentInstruction(
        taker,
        getAssociatedTokenAddressSync(new PublicKey(mint), taker),
        taker,
        new PublicKey(mint)
      );

    it("logs, without refusing, the taker's own account create for a mint the route never names", async () => {
      // One live USDC → PYUSD build carried such a create and could not be
      // reproduced; the log records the shape so the rule can tighten later.
      const bonk = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
      http.get.mockResolvedValue({ data: withOther(ownAtaCreate(bonk)) });

      await expect(requestWithFee()).resolves.toBeDefined();
      expect(console.warn).toHaveBeenCalledWith('[SWAP_JUPITER_ATA_OFF_ROUTE]', {
        mint: bonk,
        accountInRoute: false,
        route: 'route_v2',
      });
    });

    it('refuses more than 6 account creates (live builds create at most 4)', async () => {
      const creates = Array.from({ length: 5 }, () => ownAtaCreate(USDC));
      await expectRefused(withOther(...creates), 'more than 6 account creates');
    });

    it('refuses a wrap when the input is not SOL', async () => {
      const usdcToSolWithWrap = {
        ...noFee,
        setupInstructions: [...noFee.setupInstructions, toWire(wrap(1000000))],
      };
      await expectRefused(usdcToSolWithWrap, 'wrap transfer without SOL input', () => request());
    });
  });

  describe('binds the route_v2 call to the taker and to the amounts it reports', () => {
    const strangerUsdc = getAssociatedTokenAddressSync(
      new PublicKey(USDC),
      STRANGER,
      true
    ).toBase58();

    /**
     * The fee fixture with its router call edited. route_v2 data (Jupiter v6
     * on-chain IDL): 8-byte discriminator, in u64 @8, quoted out u64 @16,
     * slippage u16 @24, platform fee u16 @26, positive slippage u16 @28;
     * accounts: 0 authority, 1 source, 2 destination, 3 source mint,
     * 4 destination mint, 5/6 their token programs, 7 destination override
     * (the Jupiter program id when empty), 10 Salmon's fee account.
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

    const setAccount = (index, pubkey) => () =>
      routeWith(({ accounts }) => {
        accounts[index].pubkey = pubkey;
      });

    it.each([
      ['pays the output to a foreign account', setAccount(2, strangerUsdc), 'route_v2 destination'],
      [
        'redirects the output through the override slot',
        setAccount(7, strangerUsdc),
        'route_v2 destination override',
      ],
      ['swaps under another authority', setAccount(0, STRANGER.toBase58()), 'route_v2 authority'],
      ['spends a token other than the input', setAccount(1, TAKER_USDC), 'route_v2 source'],
      ['names another source mint', setAccount(3, USDC), 'route_v2 source mint'],
      ['names another destination mint', setAccount(4, SOL), 'route_v2 destination mint'],
      [
        'names a source token program that is not a token program',
        setAccount(5, STRANGER.toBase58()),
        'route_v2 source token program',
      ],
      [
        'names a token program the source account does not belong to',
        setAccount(5, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
        'route_v2 source',
      ],
      [
        "pays Salmon's fee to a foreign account",
        setAccount(10, strangerUsdc),
        'route_v2 fee account',
      ],
      [
        'is not route_v2',
        () => routeWith(({ data }) => Buffer.from([0, ...data.subarray(1)])),
        'unknown router call 0064facc31c4af14',
      ],
      [
        'is truncated',
        () => routeWith(({ data }) => data.subarray(0, 20)),
        'route_v2 data too short',
      ],
      [
        'stops before its positive-slippage field',
        () => routeWith(({ data }) => data.subarray(0, 29)),
        'route_v2 data too short',
      ],
      [
        'spends more than the requested amount',
        () => routeWith(({ data }) => void data.writeBigUInt64LE(20000000n, 8)),
        'route_v2 in amount',
      ],
      [
        'allows more slippage than requested',
        () => routeWith(({ data }) => void data.writeUInt16LE(10000, 24)),
        'route_v2 slippage',
      ],
      [
        'takes another platform fee than Salmon asked for',
        () => routeWith(({ data }) => void data.writeUInt16LE(500, 26)),
        'route_v2 platform fee',
      ],
      [
        'keeps positive slippage for the platform',
        () => routeWith(({ data }) => void data.writeUInt16LE(10000, 28)),
        'route_v2 positive slippage',
      ],
      [
        'reports an output the call does not quote',
        () => ({ ...withFee, outAmount: '2000000' }),
        'route_v2 quoted out amount',
      ],
      [
        'reports a minimum the call does not enforce',
        () => ({ ...withFee, otherAmountThreshold: '1170000' }),
        'route_v2 minimum out amount',
      ],
    ])('refuses a router call that %s', async (_, tampered, reason) => {
      await expectRefused(tampered(), reason);
    });

    it('refuses a platform fee when Salmon asked for none', async () => {
      await expectRefused(withFee, 'route_v2 platform fee', () =>
        request({ inputMint: SOL, outputMint: USDC, amount: '10000000' })
      );
    });

    it('accepts the minimum rounded down as well as up (1173138 at 50 bps = 1167272.31)', async () => {
      http.get.mockResolvedValue({ data: { ...withFee, otherAmountThreshold: '1167272' } });
      await expect(requestWithFee()).resolves.toMatchObject({
        amountOut: '1173138',
        minAmountOut: '1167272',
      });
    });
  });

  /**
   * Real `/build` answers (taker 86xC…, slippage 50, Salmon fee 50 bps into
   * the fee owner's account of the output mint). Lookup-table contents are
   * emptied: the adapter reads only the table addresses.
   */
  describe('accepts the builds Jupiter really answers with', () => {
    const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
    const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
    const CASES = {
      'route_v2, multi-hop USDC → BONK': [
        'jupiter-build-usdc-bonk-multihop.json',
        USDC,
        BONK,
        '1000000',
        '7ncQheYomTJUFPZdM2p67S6Q4sVnAQHouZUCRiCr5irJ',
      ],
      'route_v2, USDC → PYUSD (Token-2022 output)': [
        'jupiter-build-usdc-pyusd.json',
        USDC,
        PYUSD,
        '1000000',
        '5vkp91Qq5Pe2DjZ6qh1jGk52PKQj6pTbvLzU5HUi8ADV',
      ],
      'shared_accounts_route_v2, multi-hop USDC → BONK': [
        'jupiter-build-usdc-bonk-shared.json',
        USDC,
        BONK,
        '1000000',
        '7ncQheYomTJUFPZdM2p67S6Q4sVnAQHouZUCRiCr5irJ',
      ],
      'shared_accounts_route_v2, PYUSD (Token-2022 input) → USDC': [
        'jupiter-build-pyusd-usdc-shared.json',
        PYUSD,
        USDC,
        '1000000',
        FEE_ATA,
      ],
      'shared_accounts_route_v2, SOL → JUP with wrap and unwrap': [
        'jupiter-build-sol-jup-shared.json',
        SOL,
        JUP,
        '10000000',
        '4HZjsLFVfPqkamTiCaHypxiApqQLBx57r6hG59TmJyvc',
      ],
    };
    const load = (file) => require(`./fixtures/${file}`);
    const requestFor = (name, extra = {}) => {
      const [, inputMint, outputMint, amount, recipient] = CASES[name];
      return request({
        inputMint,
        outputMint,
        amount,
        fee: { recipient, bps: 50, side: 'buy' },
        ...extra,
      });
    };

    it.each(Object.keys(CASES))('%s', async (name) => {
      const body = load(CASES[name][0]);
      http.get.mockResolvedValue({ data: body });

      const result = await requestFor(name);

      expect(result.amountOut).toBe(body.outAmount);
      expect(result.minAmountOut).toBe(body.otherAmountThreshold);
      const groups = [
        ...body.setupInstructions,
        body.swapInstruction,
        ...(body.cleanupInstruction ? [body.cleanupInstruction] : []),
        ...body.otherInstructions,
      ];
      expect(result.instructions).toHaveLength(groups.length);
    });

    it("refuses a Token-2022 output paid to someone else's account", async () => {
      const body = load(CASES['route_v2, USDC → PYUSD (Token-2022 output)'][0]);
      const strangerPyusd = getAssociatedTokenAddressSync(
        new PublicKey(PYUSD),
        STRANGER,
        true,
        new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
      ).toBase58();
      const accounts = body.swapInstruction.accounts.map((account, index) =>
        index === 2 ? { ...account, pubkey: strangerPyusd } : account
      );
      await expectRefused(
        { ...body, swapInstruction: { ...body.swapInstruction, accounts } },
        'route_v2 destination',
        () => requestFor('route_v2, USDC → PYUSD (Token-2022 output)')
      );
    });

    /**
     * shared_accounts_route_v2 data (Jupiter v6 on-chain IDL): 8-byte
     * discriminator, route id u8 @8, in u64 @9, quoted out u64 @17, slippage
     * u16 @25, platform fee u16 @27, positive slippage u16 @29; accounts:
     * 1 authority, 2 source, 5 destination, 6/7 mints, 8/9 their token
     * programs, 12 Salmon's fee account.
     */
    const SHARED = 'shared_accounts_route_v2, multi-hop USDC → BONK';
    const sharedWith = (edit) => {
      const body = load(CASES[SHARED][0]);
      const data = Buffer.from(body.swapInstruction.data, 'base64');
      const accounts = body.swapInstruction.accounts.map((account) => ({ ...account }));
      const edited = edit({ data, accounts }) || data;
      return {
        ...body,
        swapInstruction: { ...body.swapInstruction, accounts, data: edited.toString('base64') },
      };
    };
    const takerBonkAta = getAssociatedTokenAddressSync(
      new PublicKey(BONK),
      new PublicKey(TAKER)
    ).toBase58();
    const strangerBonk = getAssociatedTokenAddressSync(
      new PublicKey(BONK),
      STRANGER,
      true
    ).toBase58();

    it.each([
      [
        'shared_accounts_route_v2 positive slippage',
        () => sharedWith(({ data }) => void data.writeUInt16LE(10000, 29)),
      ],
      [
        'shared_accounts_route_v2 fee account',
        () =>
          sharedWith(({ accounts }) => {
            accounts[12].pubkey = strangerBonk;
          }),
      ],
      [
        'shared_accounts_route_v2 source mint',
        () =>
          sharedWith(({ accounts }) => {
            accounts[6].pubkey = BONK;
          }),
      ],
      [
        'shared_accounts_route_v2 destination mint',
        () =>
          sharedWith(({ accounts }) => {
            accounts[7].pubkey = USDC;
          }),
      ],
      [
        'shared_accounts_route_v2 destination',
        () =>
          sharedWith(({ accounts }) => {
            accounts[5].pubkey = strangerBonk;
          }),
      ],
      [
        'shared_accounts_route_v2 authority',
        () =>
          sharedWith(({ accounts }) => {
            accounts[1].pubkey = STRANGER.toBase58();
          }),
      ],
      [
        'shared_accounts_route_v2 source',
        () =>
          sharedWith(({ accounts }) => {
            accounts[2].pubkey = takerBonkAta;
          }),
      ],
      [
        'shared_accounts_route_v2 in amount',
        () => sharedWith(({ data }) => void data.writeBigUInt64LE(2000000n, 9)),
      ],
      [
        'shared_accounts_route_v2 slippage',
        () => sharedWith(({ data }) => void data.writeUInt16LE(10000, 25)),
      ],
      [
        'shared_accounts_route_v2 platform fee',
        () => sharedWith(({ data }) => void data.writeUInt16LE(500, 27)),
      ],
      [
        'shared_accounts_route_v2 quoted out amount',
        () => ({ ...sharedWith(() => {}), outAmount: '99999999999' }),
      ],
      [
        'unknown router call 9d8ab85215f4f324',
        () =>
          sharedWith(({ data }) =>
            Buffer.concat([Buffer.from('9d8ab85215f4f324', 'hex'), data.subarray(8)])
          ),
      ],
    ])('refuses a tampered call, naming the check: %s', async (reason, tampered) => {
      http.get.mockResolvedValue({ data: tampered() });
      await expect(requestFor(SHARED)).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'provider_bad_response',
      });
      expect(console.error).toHaveBeenCalledWith('[SWAP_PROVIDER_BAD_RESPONSE]', {
        provider: 'jupiter',
        reason,
      });
    });

    describe('asks again while the answer is shared-accounts or too big to send', () => {
      const shared = () => load(CASES[SHARED][0]);
      const routeV2 = () => load(CASES['route_v2, multi-hop USDC → BONK'][0]);
      const routerCallOf = (result) =>
        result.instructions.find((ix) => ix.programId.toBase58() === JUPITER).data;
      const formOf = (result) => routerCallOf(result).subarray(0, 8).toString('hex');
      /** Serialized sizes, one per answer, in the order the answers arrive. */
      const measuring = (...sizes) => {
        const measure = jest.fn();
        sizes.forEach((size) => measure.mockResolvedValueOnce(size));
        return measure;
      };

      it('uses the route_v2 answer of the second call', async () => {
        http.get
          .mockResolvedValueOnce({ data: shared() })
          .mockResolvedValueOnce({ data: routeV2() });

        const result = await requestFor(SHARED);

        expect(http.get).toHaveBeenCalledTimes(2);
        expect(formOf(result)).toBe('bb64facc31c4af14');
        expect(result.amountOut).toBe(routeV2().outAmount);
        expect(console.warn).toHaveBeenCalledWith('[SWAP_JUPITER_SHARED_RETRY]', {
          attempts: 2,
          route: 'route_v2',
          sizes: [null, null],
        });
      });

      it('returns the shared-accounts answer after three shared answers', async () => {
        http.get.mockResolvedValue({ data: shared() });

        const result = await requestFor(SHARED);

        expect(http.get).toHaveBeenCalledTimes(3);
        expect(formOf(result)).toBe('d19853937cfed8e9');
        expect(console.warn).toHaveBeenCalledWith('[SWAP_JUPITER_SHARED_RETRY]', {
          attempts: 3,
          route: 'shared_accounts_route_v2',
          sizes: [null, null, null],
        });
      });

      it('spends no extra call on a route_v2 answer whose size is unknown', async () => {
        http.get.mockResolvedValue({ data: routeV2() });

        await requestFor(SHARED, { measure: measuring(null) });
        await requestFor(SHARED, { measure: jest.fn().mockRejectedValue(new Error('rpc down')) });

        expect(http.get).toHaveBeenCalledTimes(2);
        expect(console.warn).not.toHaveBeenCalledWith(
          '[SWAP_JUPITER_SHARED_RETRY]',
          expect.anything()
        );
      });

      it('asks again only when a rate-limit token is free now, with no backoff retries', async () => {
        http.get
          .mockResolvedValueOnce({ data: shared() })
          .mockResolvedValueOnce({ data: routeV2() });

        await requestFor(SHARED);

        expect(providerCall.mock.calls[0][2]).not.toHaveProperty('noWait');
        expect(providerCall.mock.calls[1][2]).toMatchObject({ noWait: true });
      });

      it('calls once when the first answer is route_v2 and fits', async () => {
        http.get.mockResolvedValue({ data: routeV2() });
        const measure = measuring(1100);

        await requestFor(SHARED, { measure });

        expect(http.get).toHaveBeenCalledTimes(1);
        expect(measure).toHaveBeenCalledWith(
          expect.any(Array),
          Object.keys(routeV2().addressesByLookupTableAddress)
        );
        expect(console.warn).not.toHaveBeenCalledWith(
          '[SWAP_JUPITER_SHARED_RETRY]',
          expect.anything()
        );
      });

      it('takes a shared answer that fits over a route_v2 answer that does not', async () => {
        http.get
          .mockResolvedValueOnce({ data: routeV2() })
          .mockResolvedValueOnce({ data: shared() })
          .mockResolvedValueOnce({ data: shared() });

        const result = await requestFor(SHARED, { measure: measuring(1300, 1100, 1150) });

        expect(http.get).toHaveBeenCalledTimes(3);
        expect(formOf(result)).toBe('d19853937cfed8e9');
        expect(console.warn).toHaveBeenCalledWith('[SWAP_JUPITER_SHARED_RETRY]', {
          attempts: 3,
          route: 'shared_accounts_route_v2',
          sizes: [1300, 1100, 1150],
        });
      });

      it('takes a later route_v2 answer that fits after one that does not', async () => {
        http.get.mockResolvedValue({ data: routeV2() });

        const result = await requestFor(SHARED, { measure: measuring(1300, 1200) });

        expect(http.get).toHaveBeenCalledTimes(2);
        expect(formOf(result)).toBe('bb64facc31c4af14');
        expect(console.warn).toHaveBeenCalledWith('[SWAP_JUPITER_SHARED_RETRY]', {
          attempts: 2,
          route: 'route_v2',
          sizes: [1300, 1200],
        });
      });

      it('never lets a later answer that fails validation displace an earlier valid one', async () => {
        const stranger = getAssociatedTokenAddressSync(
          new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'),
          STRANGER,
          true
        ).toBase58();
        const tampered = routeV2();
        const paysStranger = {
          ...tampered,
          swapInstruction: {
            ...tampered.swapInstruction,
            accounts: tampered.swapInstruction.accounts.map((account, index) =>
              index === 2 ? { ...account, pubkey: stranger } : account
            ),
          },
        };
        http.get
          .mockResolvedValueOnce({ data: shared() })
          .mockResolvedValueOnce({ data: paysStranger });

        const result = await requestFor(SHARED);

        expect(http.get).toHaveBeenCalledTimes(2);
        expect(formOf(result)).toBe('d19853937cfed8e9');
        expect(console.error).toHaveBeenCalledWith('[SWAP_PROVIDER_BAD_RESPONSE]', {
          provider: 'jupiter',
          reason: 'route_v2 destination',
        });
        expect(console.warn).toHaveBeenCalledWith('[SWAP_JUPITER_SHARED_RETRY]', {
          attempts: 2,
          route: 'shared_accounts_route_v2',
          sizes: [null, 'invalid'],
        });
      });

      it('returns the first answer when none fits, so the build fails as before', async () => {
        http.get
          .mockResolvedValueOnce({ data: routeV2() })
          .mockResolvedValueOnce({ data: shared() })
          .mockResolvedValueOnce({ data: routeV2() });

        const result = await requestFor(SHARED, { measure: measuring(1300, 1250, 1400) });

        expect(http.get).toHaveBeenCalledTimes(3);
        expect(formOf(result)).toBe('bb64facc31c4af14');
        expect(console.warn).toHaveBeenCalledWith('[SWAP_JUPITER_SHARED_RETRY]', {
          attempts: 3,
          route: 'route_v2',
          sizes: [1300, 1250, 1400],
        });
      });

      it('does not ask again when the request budget is nearly spent', async () => {
        process.env.REQUEST_BUDGET_MS = '10000';
        http.get.mockResolvedValue({ data: shared() });
        try {
          await requestFor(SHARED);
        } finally {
          delete process.env.REQUEST_BUDGET_MS;
        }
        expect(http.get).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith('[SWAP_JUPITER_SHARED_RETRY]', {
          attempts: 1,
          route: 'shared_accounts_route_v2',
          sizes: [null],
        });
      });

      it('keeps the shared-accounts answer when a retry fails', async () => {
        http.get
          .mockResolvedValueOnce({ data: shared() })
          .mockRejectedValueOnce({ response: { status: 429, data: {} } });

        const result = await requestFor(SHARED);

        expect(http.get).toHaveBeenCalledTimes(2);
        expect(formOf(result)).toBe('d19853937cfed8e9');
        expect(console.warn).toHaveBeenCalledWith('[SWAP_JUPITER_SHARED_RETRY]', {
          attempts: 2,
          route: 'shared_accounts_route_v2',
          sizes: [null],
          retryError: 'upstream_rate_limited',
        });
      });
    });
  });
});
