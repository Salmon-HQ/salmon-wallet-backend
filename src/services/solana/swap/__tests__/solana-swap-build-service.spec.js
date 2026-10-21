'use strict';

const mockConnection = {
  getAccountInfo: jest.fn(),
  getMultipleAccountsInfo: jest.fn(),
  getMultipleAccountsInfoAndContext: jest.fn(),
  getLatestBlockhash: jest.fn(),
  getRecentPrioritizationFees: jest.fn(),
  simulateTransaction: jest.fn(),
};
jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return { ...actual, Connection: jest.fn(() => mockConnection) };
});
jest.mock('../zeroex-swap-provider', () => ({
  requestSwapInstructions: jest.fn(),
  isConfigured: jest.fn(() => true),
  PROVIDER: { id: '0x', displayName: '0x', attribution: 'Powered by 0x' },
  FEE: { sides: ['buy', 'sell'], nativeSolAsWallet: true },
  PPM_PER_BPS: 100,
}));
jest.mock('../jupiter-swap-provider', () => ({
  requestSwapInstructions: jest.fn(),
  isConfigured: jest.fn(() => true),
  PROVIDER: { id: 'jupiter', displayName: 'Metis', attribution: 'Powered by Metis (Jupiter)' },
  FEE: { sides: ['buy'], nativeSolAsWallet: false },
}));
jest.mock('../../solana-ft-service', () => ({ getByMints: jest.fn() }));
jest.mock('../../token-metadata-service', () => ({ getByMints: jest.fn(async () => new Map()) }));

const {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} = require('@solana/web3.js');
const {
  AccountLayout,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} = require('@solana/spl-token');
const zeroex = require('../zeroex-swap-provider');
const jupiter = require('../jupiter-swap-provider');
const { getByMints } = require('../../solana-ft-service');
const tokenMetadata = require('../../token-metadata-service');
const service = require('../solana-swap-build-service');

const TAKER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const FEE_OWNER = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const SETTLER = 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m';
const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
const locals = {
  network: { id: 'solana-mainnet', config: { nodeUrl: 'http://rpc.test' } },
  availability: { provider: '0x' },
};

const feeAta = getAssociatedTokenAddressSync(
  new PublicKey(USDC),
  new PublicKey(FEE_OWNER),
  false,
  TOKEN_PROGRAM_ID
).toBase58();

const swapInstruction = (extraKeys = []) =>
  new TransactionInstruction({
    programId: new PublicKey(SETTLER),
    keys: [
      { pubkey: new PublicKey(TAKER), isSigner: true, isWritable: true },
      ...extraKeys.map((k) => ({ pubkey: new PublicKey(k), isSigner: false, isWritable: true })),
    ],
    data: Buffer.from([9]),
  });

const quote = (instructions) => ({
  instructions,
  lookupTableAddresses: [],
  amountOut: '990000',
  minAmountOut: '980000',
  routePlan: [{ label: 'Raydium', percent: 100 }],
  providerRequestId: 'zid-1',
});

const params = (outputMint = USDC) => ({
  inputMint: SOL,
  outputMint,
  amount: '1000000000',
  publicKey: TAKER,
  slippageBps: 50,
});

describe('solana-swap-build-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SWAP_FEE_BPS;
    delete process.env.SWAP_FEE_ACCOUNT_OWNER;
    delete process.env.POWERUP_PRIORITY_FEE_MICROLAMPORTS;
    mockConnection.getLatestBlockhash.mockResolvedValue({ blockhash: BLOCKHASH });
    mockConnection.getMultipleAccountsInfo.mockResolvedValue([]);
    mockConnection.getMultipleAccountsInfoAndContext.mockResolvedValue({
      context: { slot: 1 },
      value: [],
    });
    mockConnection.getRecentPrioritizationFees.mockResolvedValue([]);
    mockConnection.simulateTransaction.mockResolvedValue({
      value: { err: null, unitsConsumed: 135497, logs: [], accounts: [] },
    });
  });

  const compiledPrograms = (result) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
    return tx.message.compiledInstructions.map((ix) =>
      tx.message.staticAccountKeys[ix.programIdIndex].toBase58()
    );
  };

  it('returns an UNSIGNED v0 transaction paid by the taker, no fee when none is configured', async () => {
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction()]));

    const result = await service.build(params(), locals);

    expect(zeroex.requestSwapInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ fee: null, reserveBytes: 68, taker: TAKER })
    );
    const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
    expect(tx.version).toBe(0);
    expect(tx.signatures.every((sig) => sig.every((byte) => byte === 0))).toBe(true);
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(TAKER);
    // CU limit (simulated 135497 * 1.15) + CU price (min 1000 with no recent fees) + the swap
    expect(compiledPrograms(result)).toEqual([
      'ComputeBudget111111111111111111111111111111',
      'ComputeBudget111111111111111111111111111111',
      SETTLER,
    ]);
    expect(result.priorityFeeMicroLamports).toBe(1000);
    expect(result.computeUnitLimit).toBe(155822);
    // the simulated message is the swap plus the placeholder compute budget (2)
    const [simulated] = mockConnection.simulateTransaction.mock.calls[0];
    expect(simulated.message.compiledInstructions).toHaveLength(3);
    expect(tx.message.recentBlockhash).toBe(BLOCKHASH);
    expect(result).toMatchObject({
      provider: zeroex.PROVIDER,
      providerRequestId: 'zid-1',
      amountIn: '1000000000',
      amountOut: '990000',
      minAmountOut: '980000',
      slippageBps: 50,
      salmonFee: null,
    });
    expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();
  });

  it('takes the fee from the OUTPUT token when the owner ATA for it exists (buy side)', async () => {
    process.env.SWAP_FEE_BPS = '50';
    process.env.SWAP_FEE_ACCOUNT_OWNER = FEE_OWNER;
    mockConnection.getAccountInfo
      .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID }) // USDC mint
      .mockResolvedValueOnce({ data: Buffer.alloc(165) }); // owner USDC ATA exists
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction([feeAta])]));

    const result = await service.build(params(), locals);

    expect(zeroex.requestSwapInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ fee: { recipient: feeAta, bps: 50, side: 'buy' } })
    );
    expect(result.salmonFee).toEqual({ amount: '4975', mint: USDC, side: 'output', bps: 50 });
  });

  it('pays a native-SOL fee to the owner wallet itself without any RPC lookup', async () => {
    process.env.SWAP_FEE_BPS = '50';
    process.env.SWAP_FEE_ACCOUNT_OWNER = FEE_OWNER;
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction([FEE_OWNER])]));

    await service.build({ ...params(SOL), inputMint: USDC }, locals);

    expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();
    expect(zeroex.requestSwapInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ fee: { recipient: FEE_OWNER, bps: 50, side: 'buy' } })
    );
  });

  it('falls back to the INPUT token (sell side) when only that fee account exists', async () => {
    process.env.SWAP_FEE_BPS = '50';
    process.env.SWAP_FEE_ACCOUNT_OWNER = FEE_OWNER;
    // output USDC: mint found, owner ATA missing → input is native SOL → owner wallet
    mockConnection.getAccountInfo
      .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID })
      .mockResolvedValueOnce(null);
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction([FEE_OWNER])]));

    const result = await service.build(params(), locals);

    expect(zeroex.requestSwapInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ fee: { recipient: FEE_OWNER, bps: 50, side: 'sell' } })
    );
    // 1000000000 lamports * 5000 ppm / 1e6 = 5000000
    expect(result.salmonFee).toEqual({ amount: '5000000', mint: SOL, side: 'input', bps: 50 });
  });

  it('builds WITHOUT a fee and logs [SWAP_FEE_SKIPPED] when neither fee account exists', async () => {
    process.env.SWAP_FEE_BPS = '50';
    process.env.SWAP_FEE_ACCOUNT_OWNER = FEE_OWNER;
    const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
    mockConnection.getAccountInfo
      .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID }) // USDC mint
      .mockResolvedValueOnce(null) // owner USDC ATA missing
      .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID }) // USDT mint
      .mockResolvedValueOnce(null); // owner USDT ATA missing
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction()]));

    const result = await service.build({ ...params(), inputMint: USDT }, locals);

    expect(zeroex.requestSwapInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ fee: null })
    );
    expect(result.salmonFee).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[SWAP_FEE_SKIPPED]'),
      expect.objectContaining({ inputMint: USDT, outputMint: USDC })
    );
    // Configuration read from the environment never reaches the logs.
    expect(error.mock.calls[0][1]).not.toHaveProperty('owner');
    error.mockRestore();
  });

  it('answers 502 provider_fee_mismatch when the instructions never touch the fee account', async () => {
    process.env.SWAP_FEE_BPS = '50';
    process.env.SWAP_FEE_ACCOUNT_OWNER = FEE_OWNER;
    mockConnection.getAccountInfo
      .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID })
      .mockResolvedValueOnce({ data: Buffer.alloc(165) });
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction()]));

    await expect(service.build(params(), locals)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'provider_fee_mismatch',
    });
  });

  it('follows the network: p75 of recent fees on the written accounts, clamped to [1000, 20000]', async () => {
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction([USDC])]));
    mockConnection.getRecentPrioritizationFees.mockResolvedValue(
      [0, 500, 2000, 8000, 100000].map((prioritizationFee) => ({ slot: 1, prioritizationFee }))
    );

    const result = await service.build(params(), locals);

    const [{ lockedWritableAccounts }] = mockConnection.getRecentPrioritizationFees.mock.calls[0];
    expect(lockedWritableAccounts.map((k) => k.toBase58())).toEqual([TAKER, USDC]);
    // non-zero fees sorted: 500, 2000, 8000, 100000 → p75 index floor(0.75*3)=2 → 8000
    expect(result.priorityFeeMicroLamports).toBe(8000);

    mockConnection.getRecentPrioritizationFees.mockResolvedValue([
      { slot: 1, prioritizationFee: 9e6 },
    ]);
    expect((await service.build(params(), locals)).priorityFeeMicroLamports).toBe(20000);
  });

  it('pins the priority fee to POWERUP_PRIORITY_FEE_MICROLAMPORTS and drops the instruction at 0', async () => {
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction()]));

    process.env.POWERUP_PRIORITY_FEE_MICROLAMPORTS = '777';
    let result = await service.build(params(), locals);
    expect(result.priorityFeeMicroLamports).toBe(777);
    expect(mockConnection.getRecentPrioritizationFees).not.toHaveBeenCalled();

    process.env.POWERUP_PRIORITY_FEE_MICROLAMPORTS = '0';
    result = await service.build(params(), locals);
    expect(result.priorityFeeMicroLamports).toBe(0);
    expect(result.computeUnitLimit).toBeNull();
    expect(compiledPrograms(result)).toEqual([SETTLER]);
  });

  describe('intermediate account cleanup', () => {
    const USD1 = 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB';
    const takerKey = new PublicKey(TAKER);
    const createAta = (mint) =>
      createAssociatedTokenAccountIdempotentInstruction(
        takerKey,
        getAssociatedTokenAddressSync(new PublicKey(mint), takerKey, false, TOKEN_PROGRAM_ID),
        takerKey,
        new PublicKey(mint),
        TOKEN_PROGRAM_ID
      );
    const CLOSE_ACCOUNT = 9;
    const closeInstructions = (result) => {
      const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
      return tx.message.compiledInstructions.filter(
        (ix) =>
          tx.message.staticAccountKeys[ix.programIdIndex].equals(TOKEN_PROGRAM_ID) &&
          ix.data[0] === CLOSE_ACCOUNT
      );
    };

    it('closes the intermediate ATA the route creates, refunding rent to the taker', async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(
        quote([createAta(USD1), createAta(USDC), swapInstruction()])
      );
      // the USD1 account does not exist yet → ours to close; USDC is the output → kept
      mockConnection.getMultipleAccountsInfo.mockResolvedValue([null]);

      const result = await service.build(params(), locals);

      const closes = closeInstructions(result);
      expect(closes).toHaveLength(1);
      const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
      const keys = closes[0].accountKeyIndexes.map((i) =>
        tx.message.staticAccountKeys[i].toBase58()
      );
      const usd1Ata = getAssociatedTokenAddressSync(new PublicKey(USD1), takerKey).toBase58();
      expect(keys).toEqual([usd1Ata, TAKER, TAKER]); // account, rent destination, owner
      expect(result.intermediateAccountsClosed).toBe(1);
      // the simulated message already carries the close (plus the 2 placeholder budget instructions)
      const [simulated] = mockConnection.simulateTransaction.mock.calls[0];
      expect(simulated.message.compiledInstructions).toHaveLength(6);
      const [queried] = mockConnection.getMultipleAccountsInfo.mock.calls[0];
      expect(queried.map((k) => k.toBase58())).toEqual([usd1Ata]);
    });

    it('closes the wrapped-SOL account a native-SOL input opens', async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(
        quote([createAta(SOL), createAta(USDC), swapInstruction()])
      );
      // wrapped-SOL account is new → closed; USDC is the output → kept
      mockConnection.getMultipleAccountsInfo.mockResolvedValue([null]);

      const result = await service.build(params(), locals);

      const closes = closeInstructions(result);
      expect(closes).toHaveLength(1);
      const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
      const wsolAta = getAssociatedTokenAddressSync(new PublicKey(SOL), takerKey).toBase58();
      expect(tx.message.staticAccountKeys[closes[0].accountKeyIndexes[0]].toBase58()).toBe(wsolAta);
      expect(result.intermediateAccountsClosed).toBe(1);
    });

    it('does not re-close an account the provider already closes (Jupiter closes wrapped SOL itself)', async () => {
      const wsolAta = getAssociatedTokenAddressSync(new PublicKey(SOL), takerKey);
      const providerClose = createCloseAccountInstruction(wsolAta, takerKey, takerKey);
      zeroex.requestSwapInstructions.mockResolvedValue(
        quote([createAta(SOL), swapInstruction(), providerClose])
      );

      const result = await service.build(params(USDC), locals);

      expect(mockConnection.getMultipleAccountsInfo).not.toHaveBeenCalled();
      expect(closeInstructions(result)).toHaveLength(1); // the provider's own close only
      expect(result.intermediateAccountsClosed).toBe(0);
    });

    it('leaves a pre-existing intermediate account alone', async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(quote([createAta(USD1), swapInstruction()]));
      mockConnection.getMultipleAccountsInfo.mockResolvedValueOnce([{ data: Buffer.alloc(165) }]);

      const result = await service.build(params(), locals);

      expect(closeInstructions(result)).toHaveLength(0);
      expect(result.intermediateAccountsClosed).toBe(0);
    });

    it('drops the cleanup and logs [CLEANUP_SKIPPED] when the simulation rejects it', async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(quote([createAta(USD1), swapInstruction()]));
      mockConnection.getMultipleAccountsInfo.mockResolvedValue([null]);
      mockConnection.simulateTransaction
        .mockResolvedValueOnce({ value: { err: { InstructionError: [2, 'Custom'] }, logs: [] } })
        .mockResolvedValueOnce({
          value: { err: null, unitsConsumed: 100000, logs: [], accounts: [] },
        });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.build(params(), locals);

      expect(closeInstructions(result)).toHaveLength(0);
      expect(result.intermediateAccountsClosed).toBe(0);
      expect(result.computeUnitLimit).toBe(115000);
      expect(mockConnection.simulateTransaction).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[CLEANUP_SKIPPED]'),
        expect.objectContaining({ accounts: 1 })
      );
      warn.mockRestore();
    });
  });

  it('refuses a quote the runtime rejects with 422 simulation_failed, and 503 when the RPC could not simulate', async () => {
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction()]));
    mockConnection.simulateTransaction.mockResolvedValue({
      value: { err: { InstructionError: [0, { Custom: 6001 }] }, unitsConsumed: 0, logs: [] },
    });
    await expect(service.build(params(), locals)).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'simulation_failed',
    });

    mockConnection.simulateTransaction.mockResolvedValue({
      value: {
        err: { InstructionError: [4, { Custom: 6001 }] },
        unitsConsumed: 0,
        logs: [
          'Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1771',
        ],
      },
    });
    await expect(service.build(params(), locals)).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'slippage_exceeded',
    });

    mockConnection.simulateTransaction.mockRejectedValue(new Error('ECONNRESET'));
    await expect(service.build(params(), locals)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'simulation_unavailable',
    });
  });

  it('falls back to the minimum priority fee when the RPC read fails', async () => {
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction()]));
    mockConnection.getRecentPrioritizationFees.mockRejectedValue(new Error('rpc down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await service.build(params(), locals);

    expect(result.priorityFeeMicroLamports).toBe(1000);
    warn.mockRestore();
  });

  it('refuses a non-routable Token-2022 mint with 422 token_not_supported before calling 0x', async () => {
    tokenMetadata.getByMints.mockResolvedValueOnce(
      new Map([[USDC, { id: USDC, symbol: 'BERN', swappable: false }]])
    );

    await expect(service.build(params(), locals)).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'token_not_supported',
    });
    expect(zeroex.requestSwapInstructions).not.toHaveBeenCalled();
  });

  it('fails loudly when a lookup table the provider named is not on chain', async () => {
    zeroex.requestSwapInstructions.mockResolvedValue({
      ...quote([swapInstruction()]),
      lookupTableAddresses: ['AddressLookupTab1e1111111111111111111111111'],
    });
    mockConnection.getMultipleAccountsInfo.mockResolvedValue([null]);

    await expect(service.build(params(), locals)).rejects.toThrow(/lookup table .* not found/);
  });

  describe('estimateFeeAmount', () => {
    it('buy side: grosses the net output back up and rounds the fee up', () => {
      // net 990000 at 50 bps (5000 ppm): fee = ceil(990000 * 5000 / 995000) = 4975
      const at = (amountOut) => service.estimateFeeAmount({ side: 'buy', amountOut, bps: 50 });
      expect(at('990000')).toBe('4975');
      expect(at('1')).toBe('1');
      expect(at('0')).toBe('0');
    });

    it('sell side: takes the ppm share of the input, rounded up', () => {
      const at = (amountIn) => service.estimateFeeAmount({ side: 'sell', amountIn, bps: 50 });
      expect(at('1000000')).toBe('5000');
      expect(at('1')).toBe('1');
      expect(at('199')).toBe('1');
    });
  });

  describe('resolveAmount', () => {
    it('passes a positive raw amount through and rejects zero/negative/decimal', async () => {
      expect(await service.resolveAmount({ amount: '5' }, locals)).toEqual({ amount: '5' });
      for (const amount of ['0', '-5', '1.5', 'x']) {
        expect((await service.resolveAmount({ amount }, locals)).error).toBe('invalid_parameter');
      }
    });

    it('converts uiAmount with catalog decimals and short-circuits SOL', async () => {
      expect(await service.resolveAmount({ uiAmount: '1.5', inputMint: SOL }, locals)).toEqual({
        amount: '1500000000',
      });
      getByMints.mockResolvedValue([{ id: USDC, decimals: 6 }]);
      expect(await service.resolveAmount({ uiAmount: '2', inputMint: USDC }, locals)).toEqual({
        amount: '2000000',
      });
      getByMints.mockResolvedValue([]);
      expect((await service.resolveAmount({ uiAmount: '2', inputMint: USDC }, locals)).error).toBe(
        'unknown_mint'
      );
      expect((await service.resolveAmount({}, locals)).error).toBe('missing_parameter');
    });
  });

  describe('resolveSlippage', () => {
    it('defaults to 50 and bounds 0..10000', () => {
      expect(service.resolveSlippage(undefined)).toEqual({ slippageBps: 50 });
      expect(service.resolveSlippage('100')).toEqual({ slippageBps: 100 });
      expect(service.resolveSlippage('10001').error).toBe('invalid_parameter');
      expect(service.resolveSlippage('-1').error).toBe('invalid_parameter');
      expect(service.resolveSlippage('1.5').error).toBe('invalid_parameter');
    });
  });

  describe('provider from the availability row', () => {
    it('answers 503 upstream_unavailable when the row names a provider without a credential', async () => {
      zeroex.isConfigured.mockReturnValueOnce(false);
      await expect(service.build(params(), locals)).rejects.toMatchObject({
        statusCode: 503,
        errorCode: 'upstream_unavailable',
      });
      expect(zeroex.requestSwapInstructions).not.toHaveBeenCalled();
    });

    it('answers 503 upstream_unavailable when the row names an unknown provider, never falling back', async () => {
      const other = { ...locals, availability: { provider: 'raydium' } };
      await expect(service.build(params(), other)).rejects.toMatchObject({
        statusCode: 503,
        errorCode: 'upstream_unavailable',
      });
      expect(zeroex.requestSwapInstructions).not.toHaveBeenCalled();
    });
  });

  describe('Jupiter row', () => {
    const jupiterLocals = { ...locals, availability: { provider: 'jupiter' } };
    const wsolFeeAta = getAssociatedTokenAddressSync(
      new PublicKey(SOL),
      new PublicKey(FEE_OWNER),
      false,
      TOKEN_PROGRAM_ID
    ).toBase58();

    beforeEach(() => {
      process.env.SWAP_FEE_BPS = '50';
      process.env.SWAP_FEE_ACCOUNT_OWNER = FEE_OWNER;
    });

    it('builds through the Jupiter adapter with the same shape, fee from the output token account', async () => {
      // mint account + the owner's USDC ATA exist
      mockConnection.getAccountInfo.mockResolvedValue({ owner: TOKEN_PROGRAM_ID });
      jupiter.requestSwapInstructions.mockResolvedValue({
        ...quote([swapInstruction([feeAta])]),
        providerRequestId: null,
        routeFee: null,
      });

      const result = await service.build(params(USDC), jupiterLocals);

      expect(zeroex.requestSwapInstructions).not.toHaveBeenCalled();
      expect(jupiter.requestSwapInstructions).toHaveBeenCalledWith(
        expect.objectContaining({ fee: { recipient: feeAta, bps: 50, side: 'buy' } })
      );
      expect(result).toMatchObject({
        provider: jupiter.PROVIDER,
        providerRequestId: null,
        routeFee: null,
        salmonFee: { mint: USDC, side: 'output', bps: 50 },
      });
      const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
      expect(tx.signatures).toHaveLength(1);
      expect(tx.message.staticAccountKeys[0].toBase58()).toBe(TAKER);
    });

    it('lets the adapter measure an answer as the transaction it will become', async () => {
      mockConnection.getAccountInfo.mockResolvedValue({ owner: TOKEN_PROGRAM_ID });
      jupiter.requestSwapInstructions.mockResolvedValue({
        ...quote([swapInstruction([feeAta])]),
        providerRequestId: null,
        routeFee: null,
      });

      const result = await service.build(params(USDC), jupiterLocals);

      const [{ measure }] = jupiter.requestSwapInstructions.mock.calls[0];
      // Same instructions, same (no) lookup tables: the size of the bytes returned.
      await expect(measure([swapInstruction([feeAta])], [])).resolves.toBe(
        Buffer.from(result.transaction, 'base64').length
      );
    });

    it('pays a SOL-output fee to the owner wrapped-SOL account, never the wallet, and never the input side', async () => {
      // WSOL mint exists; the owner's WSOL ATA does not; the owner's USDC (input) ATA does
      mockConnection.getAccountInfo.mockImplementation(async (key) => {
        const address = key.toBase58();
        if (address === SOL || address === USDC) return { owner: TOKEN_PROGRAM_ID };
        if (address === wsolFeeAta) return null;
        if (address === feeAta) return { owner: TOKEN_PROGRAM_ID };
        return null;
      });
      jupiter.requestSwapInstructions.mockResolvedValue({
        ...quote([swapInstruction()]),
        providerRequestId: null,
        routeFee: null,
      });

      const result = await service.build(
        { ...params(SOL), inputMint: USDC, outputMint: SOL },
        jupiterLocals
      );

      expect(jupiter.requestSwapInstructions).toHaveBeenCalledWith(
        expect.objectContaining({ fee: null })
      );
      expect(result.salmonFee).toBeNull();
      const queried = mockConnection.getAccountInfo.mock.calls.map(([k]) => k.toBase58());
      expect(queried).toContain(wsolFeeAta);
      expect(queried).not.toContain(FEE_OWNER);
    });
  });

  describe('what the provider may hand back', () => {
    it('refuses a top-level program outside the swap allowlist with 502 provider_program_mismatch', async () => {
      const rogue = new TransactionInstruction({
        programId: new PublicKey('Stake11111111111111111111111111111111111111'),
        keys: [{ pubkey: new PublicKey(TAKER), isSigner: true, isWritable: true }],
        data: Buffer.from([1]),
      });
      zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction(), rogue]));
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(service.build(params(), locals)).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'provider_program_mismatch',
      });
      expect(error).toHaveBeenCalledWith(
        '[POWERUP_PROGRAM_MISMATCH] swap invokes an undeclared program',
        expect.objectContaining({ programId: 'Stake11111111111111111111111111111111111111' })
      );
      error.mockRestore();
    });

    it("refuses a transaction that needs a signature besides the caller's", async () => {
      const other = new TransactionInstruction({
        programId: new PublicKey(SETTLER),
        keys: [
          { pubkey: new PublicKey(TAKER), isSigner: true, isWritable: true },
          { pubkey: new PublicKey(FEE_OWNER), isSigner: true, isWritable: false },
        ],
        data: Buffer.from([9]),
      });
      zeroex.requestSwapInstructions.mockResolvedValue(quote([other]));
      await expect(service.build(params(), locals)).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'provider_signer_mismatch',
      });
    });
  });

  describe("balance guard: what the simulated swap does to the taker's accounts", () => {
    const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    const STRANGER = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
    const ata = (mint) =>
      getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(TAKER)).toBase58();
    const TAKER_USDC = ata(USDC);
    const TAKER_BONK = ata(BONK);
    const TAKER_WSOL = ata(NATIVE_MINT.toBase58());
    const RENT = 2039280;
    // 5000 per signature + the placeholder 1.4M CU at the minimum 1000 µL/CU.
    const FEES = 6400;

    const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
    const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    const SLOT = 424242;

    const tokenData = ({ mint, owner = TAKER, amount, delegate, delegatedAmount = 0 }) => {
      const data = Buffer.alloc(AccountLayout.span);
      AccountLayout.encode(
        {
          mint: new PublicKey(mint),
          owner: new PublicKey(owner),
          amount: BigInt(amount),
          delegateOption: delegate ? 1 : 0,
          delegate: delegate ? new PublicKey(delegate) : PublicKey.default,
          state: 1,
          isNativeOption: 0,
          isNative: 0n,
          delegatedAmount: BigInt(delegatedAmount),
          closeAuthorityOption: 0,
          closeAuthority: PublicKey.default,
        },
        data
      );
      return data;
    };
    const wallet = (lamports) => ({
      lamports,
      owner: SystemProgram.programId,
      data: Buffer.alloc(0),
    });
    const token = (fields, lamports = RENT) => ({
      lamports,
      owner: TOKEN_PROGRAM_ID,
      data: tokenData(fields),
    });

    /** A Token-2022 account carrying extensions: account-type byte 2 at 165, then more. */
    const token2022 = (fields, lamports = RENT) => ({
      lamports,
      owner: TOKEN_2022,
      data: Buffer.concat([tokenData(fields), Buffer.from([2, 0, 0, 0, 0])]),
    });

    /** Accounts as the RPC reads them before (sliced as asked), and as the simulation leaves them. */
    const world = ({ before, after }) => {
      mockConnection.getMultipleAccountsInfoAndContext.mockImplementation(async (keys, config) => ({
        context: { slot: SLOT },
        value: keys.map((key) => {
          const info = before[key.toBase58()];
          if (!info || !config?.dataSlice) return info ?? null;
          const { offset, length } = config.dataSlice;
          return { ...info, data: info.data.subarray(offset, offset + length) };
        }),
      }));
      mockConnection.simulateTransaction.mockImplementation(async (tx, config) => ({
        value: {
          err: null,
          unitsConsumed: 135497,
          logs: [],
          accounts: (config?.accounts?.addresses ?? []).map((address) =>
            after[address]
              ? {
                  lamports: after[address].lamports,
                  owner: after[address].owner.toBase58(),
                  data: [after[address].data.toString('base64'), 'base64'],
                  executable: false,
                  rentEpoch: 0,
                }
              : null
          ),
        },
      }));
    };

    const SOL_IN = 1000000000;
    const solToUsdc = (...extraKeys) =>
      zeroex.requestSwapInstructions.mockResolvedValue(
        quote([swapInstruction([TAKER_USDC, ...extraKeys])])
      );
    const expectGuardRefusal = async (reason, request = params()) => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(service.build(request, locals)).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'provider_bad_response',
      });
      expect(error).toHaveBeenCalledWith('[SWAP_BALANCE_GUARD]', { provider: '0x', reason });
      error.mockRestore();
    };

    it('passes a swap that spends the input and the fees and pays the output to the taker', async () => {
      solToUsdc();
      world({
        before: { [TAKER]: wallet(5 * SOL_IN), [TAKER_USDC]: token({ mint: USDC, amount: 0 }) },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - FEES),
          [TAKER_USDC]: token({ mint: USDC, amount: 990000 }),
        },
      });

      await expect(service.build(params(), locals)).resolves.toMatchObject({ amountOut: '990000' });
      const [, config] = mockConnection.simulateTransaction.mock.calls[0];
      expect(config.accounts).toEqual({ encoding: 'base64', addresses: [TAKER, TAKER_USDC] });
      // The simulation runs on state at least as new as what was read before it.
      expect(config.minContextSlot).toBe(SLOT);
    });

    it('allows the rent of the token accounts the build creates for the taker', async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(
        quote([
          createAssociatedTokenAccountIdempotentInstruction(
            new PublicKey(TAKER),
            new PublicKey(TAKER_USDC),
            new PublicKey(TAKER),
            new PublicKey(USDC)
          ),
          swapInstruction([TAKER_USDC]),
        ])
      );
      world({
        before: { [TAKER]: wallet(5 * SOL_IN) },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - RENT - FEES),
          [TAKER_USDC]: token({ mint: USDC, amount: 990000 }),
        },
      });

      await expect(service.build(params(), locals)).resolves.toBeDefined();
    });

    it("unwraps the taker's own wrapped SOL without reading it as a token loss", async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(
        quote([swapInstruction([TAKER_USDC, TAKER_WSOL])])
      );
      world({
        before: {
          [TAKER]: wallet(SOL_IN),
          [TAKER_USDC]: token({ mint: USDC, amount: 5000000 }),
          [TAKER_WSOL]: token({ mint: NATIVE_MINT, amount: 3 * SOL_IN }, 3 * SOL_IN + RENT),
        },
        after: {
          [TAKER]: wallet(SOL_IN + 3 * SOL_IN + RENT + 8000000 - FEES),
          [TAKER_USDC]: token({ mint: USDC, amount: 4000000 }),
        },
      });

      await expect(
        service.build({ ...params(SOL), inputMint: USDC, amount: '1000000' }, locals)
      ).resolves.toBeDefined();
    });

    it('refuses a swap that takes tokens of another mint from the taker', async () => {
      solToUsdc(TAKER_BONK);
      world({
        before: {
          [TAKER]: wallet(5 * SOL_IN),
          [TAKER_USDC]: token({ mint: USDC, amount: 0 }),
          [TAKER_BONK]: token({ mint: BONK, amount: 100 }),
        },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - FEES),
          [TAKER_USDC]: token({ mint: USDC, amount: 990000 }),
          [TAKER_BONK]: token({ mint: BONK, amount: 0 }),
        },
      });
      await expectGuardRefusal(`taker account ${TAKER_BONK} loses ${BONK}`);
    });

    it('refuses a swap that takes more of the input than the amount', async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction([TAKER_USDC])]));
      world({
        before: { [TAKER]: wallet(SOL_IN), [TAKER_USDC]: token({ mint: USDC, amount: 5000000 }) },
        after: {
          [TAKER]: wallet(SOL_IN - FEES),
          [TAKER_USDC]: token({ mint: USDC, amount: 3000000 }),
        },
      });
      await expectGuardRefusal(`taker pays 2000000 of ${USDC}, more than 1000000`, {
        ...params(SOL),
        inputMint: USDC,
        amount: '1000000',
      });
    });

    it('refuses a swap that takes more SOL than the amount, the fees and the rent', async () => {
      solToUsdc();
      world({
        before: { [TAKER]: wallet(5 * SOL_IN), [TAKER_USDC]: token({ mint: USDC, amount: 0 }) },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - 10000000),
          [TAKER_USDC]: token({ mint: USDC, amount: 990000 }),
        },
      });
      await expectGuardRefusal(`taker loses 1010000000 lamports, more than ${SOL_IN + FEES}`);
    });

    it("refuses a swap that hands a delegate the taker's tokens", async () => {
      solToUsdc();
      world({
        before: { [TAKER]: wallet(5 * SOL_IN), [TAKER_USDC]: token({ mint: USDC, amount: 0 }) },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - FEES),
          [TAKER_USDC]: token({ mint: USDC, amount: 990000, delegate: STRANGER }),
        },
      });
      await expectGuardRefusal(`taker account ${TAKER_USDC} gains a delegate or close authority`);
    });

    it("refuses a swap that hands the taker's token account to someone else", async () => {
      solToUsdc();
      world({
        before: { [TAKER]: wallet(5 * SOL_IN), [TAKER_USDC]: token({ mint: USDC, amount: 0 }) },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - FEES),
          [TAKER_USDC]: token({ mint: USDC, amount: 990000, owner: STRANGER }),
        },
      });
      await expectGuardRefusal(`taker account ${TAKER_USDC} changes owner`);
    });

    const createFor = (address, mint) =>
      createAssociatedTokenAccountIdempotentInstruction(
        new PublicKey(TAKER),
        new PublicKey(address),
        new PublicKey(TAKER),
        new PublicKey(mint)
      );

    it('watches an output account someone funded before it existed, and refuses a delegate on it', async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(
        quote([createFor(TAKER_USDC, USDC), swapInstruction([TAKER_USDC])])
      );
      world({
        before: { [TAKER]: wallet(5 * SOL_IN), [TAKER_USDC]: wallet(1000000) },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - RENT - FEES + 1000000),
          [TAKER_USDC]: token({ mint: USDC, amount: 990000, delegate: STRANGER }),
        },
      });
      await expectGuardRefusal(`taker account ${TAKER_USDC} gains a delegate or close authority`);
    });

    it('gives no rent allowance for a create of an account the taker already has', async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(
        quote([createFor(TAKER_USDC, USDC), swapInstruction([TAKER_USDC])])
      );
      world({
        before: { [TAKER]: wallet(5 * SOL_IN), [TAKER_USDC]: token({ mint: USDC, amount: 0 }) },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - FEES - 1000000),
          [TAKER_USDC]: token({ mint: USDC, amount: 990000 }),
        },
      });
      await expectGuardRefusal(
        `taker loses ${SOL_IN + FEES + 1000000} lamports, more than ${SOL_IN + FEES}`
      );
    });

    it("gives no SOL slack for the taker's own account creates, which the guard watches", async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(
        quote([createFor(TAKER_BONK, BONK), swapInstruction([TAKER_USDC, TAKER_BONK])])
      );
      world({
        before: { [TAKER]: wallet(5 * SOL_IN), [TAKER_USDC]: token({ mint: USDC, amount: 0 }) },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - RENT - FEES - 1000000),
          [TAKER_USDC]: token({ mint: USDC, amount: 990000 }),
          [TAKER_BONK]: token({ mint: BONK, amount: 0 }),
        },
      });
      await expectGuardRefusal(
        `taker loses ${SOL_IN + FEES + 1000000} lamports, more than ${SOL_IN + FEES}`
      );
    });

    it("refuses a swap that raises an existing delegate's allowance", async () => {
      solToUsdc();
      world({
        before: {
          [TAKER]: wallet(5 * SOL_IN),
          [TAKER_USDC]: token({ mint: USDC, amount: 0, delegate: STRANGER, delegatedAmount: 10 }),
        },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - FEES),
          [TAKER_USDC]: token({
            mint: USDC,
            amount: 990000,
            delegate: STRANGER,
            delegatedAmount: 1000000,
          }),
        },
      });
      await expectGuardRefusal(`taker account ${TAKER_USDC} gains a delegate or close authority`);
    });

    it('reads a Token-2022 account with extensions from its first 166 bytes', async () => {
      const takerPyusd = getAssociatedTokenAddressSync(
        new PublicKey(PYUSD),
        new PublicKey(TAKER),
        false,
        TOKEN_2022
      ).toBase58();
      solToUsdc(takerPyusd);
      world({
        before: {
          [TAKER]: wallet(5 * SOL_IN),
          [TAKER_USDC]: token({ mint: USDC, amount: 0 }),
          [takerPyusd]: token2022({ mint: PYUSD, amount: 500 }),
        },
        after: {
          [TAKER]: wallet(5 * SOL_IN - SOL_IN - FEES),
          [TAKER_USDC]: token({ mint: USDC, amount: 990000 }),
          [takerPyusd]: token2022({ mint: PYUSD, amount: 0 }),
        },
      });
      await expectGuardRefusal(`taker account ${takerPyusd} loses ${PYUSD}`);
      const [, config] = mockConnection.getMultipleAccountsInfoAndContext.mock.calls[0];
      expect(config.dataSlice).toEqual({ offset: 0, length: 166 });
    });

    it('answers 503 simulation_unavailable when the RPC returns no post-simulation accounts', async () => {
      solToUsdc();
      mockConnection.simulateTransaction.mockResolvedValue({
        value: { err: null, unitsConsumed: 135497, logs: [] },
      });
      await expect(service.build(params(), locals)).rejects.toMatchObject({
        statusCode: 503,
        errorCode: 'simulation_unavailable',
      });
    });
  });

  describe('resolveAmount bounds', () => {
    it('accepts decimal digits inside u64 only', async () => {
      for (const bad of ['1e3', '0x10', '-5', '1.5', '0', '18446744073709551616', '007']) {
        await expect(
          service.resolveAmount({ amount: bad, inputMint: SOL }, locals)
        ).resolves.toMatchObject({ error: 'invalid_parameter' });
      }
      await expect(
        service.resolveAmount({ amount: '18446744073709551615', inputMint: SOL }, locals)
      ).resolves.toEqual({ amount: '18446744073709551615' });
      await expect(
        service.resolveAmount({ uiAmount: '1e30', inputMint: SOL }, locals)
      ).resolves.toMatchObject({ error: 'invalid_parameter' });
    });

    it.each([
      ['the smallest unit', '0.000000001', '1'],
      ['past 2^53 without rounding', '9007199.254740993', '9007199254740993'],
      ['the u64 ceiling', '18446744073.709551615', '18446744073709551615'],
      ['trailing zeros within the decimals', '2.500000000', '2500000000'],
      ['trailing zeros past the decimals', '1.0000000000', '1000000000'],
      ['a last digit inside the decimals followed by zeros', '0.0000000010', '1'],
    ])('converts a SOL uiAmount at %s exactly', async (_, uiAmount, amount) => {
      await expect(service.resolveAmount({ uiAmount, inputMint: SOL }, locals)).resolves.toEqual({
        amount,
      });
    });

    it.each([
      ['zero', '0'],
      ['zero with decimals', '0.000000000'],
      ['more decimal places than SOL has', '0.0000000001'],
      ['past u64', '18446744073.709551616'],
      ['far past u64', '100000000000000000000'],
      ['a negative number', '-1'],
      ['a bare fraction', '.5'],
      ['a trailing point', '1.'],
      ['longer than any real amount', `1.${'0'.repeat(400)}`],
    ])('refuses a SOL uiAmount that is %s with 400 invalid_parameter', async (_, uiAmount) => {
      await expect(
        service.resolveAmount({ uiAmount, inputMint: SOL }, locals)
      ).resolves.toMatchObject({ error: 'invalid_parameter' });
    });

    it('accepts trailing zeros up to the length cap', async () => {
      await expect(
        service.resolveAmount({ uiAmount: `1.${'0'.repeat(250)}`, inputMint: SOL }, locals)
      ).resolves.toEqual({ amount: '1000000000' });
    });

    it("uses the token's own decimals: 6 places pass for USDC, 7 do not", async () => {
      getByMints.mockResolvedValue([{ id: USDC, decimals: 6 }]);
      await expect(
        service.resolveAmount({ uiAmount: '1.123456', inputMint: USDC }, locals)
      ).resolves.toEqual({ amount: '1123456' });
      await expect(
        service.resolveAmount({ uiAmount: '1.1234567', inputMint: USDC }, locals)
      ).resolves.toEqual({
        error: 'invalid_parameter',
        error_description:
          "uiAmount must be a positive decimal number within the token's decimals and u64",
      });
    });

    it('treats catalog decimals outside 0..255 as an unknown mint', async () => {
      getByMints.mockResolvedValue([{ id: USDC, decimals: 256 }]);
      await expect(
        service.resolveAmount({ uiAmount: '1', inputMint: USDC }, locals)
      ).resolves.toMatchObject({ error: 'unknown_mint' });
    });
  });
});
