'use strict';

const mockConnection = {
  getAccountInfo: jest.fn(),
  getMultipleAccountsInfo: jest.fn(),
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
  PPM_PER_BPS: 100,
}));
jest.mock('../../solana-ft-service', () => ({ getByMints: jest.fn() }));
jest.mock('../../token-metadata-service', () => ({ getByMints: jest.fn(async () => new Map()) }));

const { PublicKey, TransactionInstruction, VersionedTransaction } = require('@solana/web3.js');
const {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} = require('@solana/spl-token');
const zeroex = require('../zeroex-swap-provider');
const { getByMints } = require('../../solana-ft-service');
const tokenMetadata = require('../../token-metadata-service');
const service = require('../solana-swap-build-service');

const TAKER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const FEE_OWNER = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const SETTLER = 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m';
const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
const locals = { network: { id: 'solana-mainnet', config: { nodeUrl: 'http://rpc.test' } } };

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
  routePlan: [{ dex_label: 'Raydium', ppb: 1000000000 }],
  zid: 'zid-1',
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
    delete process.env.SWAP_PRIORITY_FEE_MICROLAMPORTS;
    mockConnection.getLatestBlockhash.mockResolvedValue({ blockhash: BLOCKHASH });
    mockConnection.getMultipleAccountsInfo.mockResolvedValue([]);
    mockConnection.getRecentPrioritizationFees.mockResolvedValue([]);
    mockConnection.simulateTransaction.mockResolvedValue({
      value: { err: null, unitsConsumed: 135497, logs: [] },
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
    // the simulated message is the bare swap, before any budget instruction
    const [simulated] = mockConnection.simulateTransaction.mock.calls[0];
    expect(simulated.message.compiledInstructions).toHaveLength(1);
    expect(tx.message.recentBlockhash).toBe(BLOCKHASH);
    expect(result).toMatchObject({
      provider: service.PROVIDER,
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

  it('pins the priority fee to SWAP_PRIORITY_FEE_MICROLAMPORTS and drops the instruction at 0', async () => {
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction()]));

    process.env.SWAP_PRIORITY_FEE_MICROLAMPORTS = '777';
    let result = await service.build(params(), locals);
    expect(result.priorityFeeMicroLamports).toBe(777);
    expect(mockConnection.getRecentPrioritizationFees).not.toHaveBeenCalled();

    process.env.SWAP_PRIORITY_FEE_MICROLAMPORTS = '0';
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
      // the simulated message already carries the close
      const [simulated] = mockConnection.simulateTransaction.mock.calls[0];
      expect(simulated.message.compiledInstructions).toHaveLength(4);
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

    it('leaves a pre-existing intermediate account alone', async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(quote([createAta(USD1), swapInstruction()]));
      mockConnection.getMultipleAccountsInfo.mockResolvedValue([{ data: Buffer.alloc(165) }]);

      const result = await service.build(params(), locals);

      expect(closeInstructions(result)).toHaveLength(0);
      expect(result.intermediateAccountsClosed).toBe(0);
    });

    it('drops the cleanup and logs [SWAP_CLEANUP_SKIPPED] when the simulation rejects it', async () => {
      zeroex.requestSwapInstructions.mockResolvedValue(quote([createAta(USD1), swapInstruction()]));
      mockConnection.getMultipleAccountsInfo.mockResolvedValue([null]);
      mockConnection.simulateTransaction
        .mockResolvedValueOnce({ value: { err: { InstructionError: [2, 'Custom'] }, logs: [] } })
        .mockResolvedValueOnce({ value: { err: null, unitsConsumed: 100000, logs: [] } });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.build(params(), locals);

      expect(closeInstructions(result)).toHaveLength(0);
      expect(result.intermediateAccountsClosed).toBe(0);
      expect(result.computeUnitLimit).toBe(115000);
      expect(mockConnection.simulateTransaction).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[SWAP_CLEANUP_SKIPPED]'),
        expect.objectContaining({ accounts: 1 })
      );
      warn.mockRestore();
    });
  });

  it('falls back to a fixed CU limit when the simulation fails, still returning the quote', async () => {
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction()]));
    mockConnection.simulateTransaction.mockResolvedValue({
      value: { err: { InstructionError: [0, 'Custom'] }, unitsConsumed: 0, logs: [] },
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await service.build(params(), locals);

    expect(result.computeUnitLimit).toBe(400000);
    expect(result.transaction).toEqual(expect.any(String));
    warn.mockRestore();
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
});
