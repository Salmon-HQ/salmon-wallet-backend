'use strict';

const mockConnection = {
  getAccountInfo: jest.fn(),
  getMultipleAccountsInfo: jest.fn(),
  getLatestBlockhash: jest.fn(),
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

const { PublicKey, TransactionInstruction, VersionedTransaction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const zeroex = require('../zeroex-swap-provider');
const { getByMints } = require('../../solana-ft-service');
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
  });

  it('returns an UNSIGNED v0 transaction paid by the taker, no fee when none is configured', async () => {
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction()]));

    const result = await service.build(params(), locals);

    expect(zeroex.requestSwapInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ fee: null, reserveBytes: 0, taker: TAKER })
    );
    const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
    expect(tx.version).toBe(0);
    expect(tx.signatures.every((sig) => sig.every((byte) => byte === 0))).toBe(true);
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(TAKER);
    expect(tx.message.compiledInstructions).toHaveLength(1);
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

  it('pays the fee to the owner ATA of the output mint and reports the fee line', async () => {
    process.env.SWAP_FEE_BPS = '50';
    process.env.SWAP_FEE_ACCOUNT_OWNER = FEE_OWNER;
    mockConnection.getAccountInfo
      .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID }) // mint
      .mockResolvedValueOnce({ data: Buffer.alloc(165) }); // fee ATA exists
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction([feeAta])]));

    const result = await service.build(params(), locals);

    expect(zeroex.requestSwapInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ fee: { recipient: feeAta, bps: 50 } })
    );
    expect(result.salmonFee).toEqual({ amount: '4975', mint: USDC, bps: 50 });
  });

  it('pays a native-SOL fee to the owner wallet itself', async () => {
    process.env.SWAP_FEE_BPS = '50';
    process.env.SWAP_FEE_ACCOUNT_OWNER = FEE_OWNER;
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction([FEE_OWNER])]));

    await service.build({ ...params(SOL), inputMint: USDC }, locals);

    expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();
    expect(zeroex.requestSwapInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ fee: { recipient: FEE_OWNER, bps: 50 } })
    );
  });

  it('answers 503 fee_account_missing before calling the provider when the fee ATA does not exist', async () => {
    process.env.SWAP_FEE_BPS = '50';
    process.env.SWAP_FEE_ACCOUNT_OWNER = FEE_OWNER;
    mockConnection.getAccountInfo
      .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID })
      .mockResolvedValueOnce(null);

    await expect(service.build(params(), locals)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'fee_account_missing',
    });
    expect(zeroex.requestSwapInstructions).not.toHaveBeenCalled();
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

  it('prepends a compute-unit price instruction and reserves bytes when a priority fee is set', async () => {
    process.env.SWAP_PRIORITY_FEE_MICROLAMPORTS = '1000';
    zeroex.requestSwapInstructions.mockResolvedValue(quote([swapInstruction()]));

    const result = await service.build(params(), locals);

    expect(zeroex.requestSwapInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ reserveBytes: 52 })
    );
    const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
    expect(tx.message.compiledInstructions).toHaveLength(2);
    const budgetProgram =
      tx.message.staticAccountKeys[tx.message.compiledInstructions[0].programIdIndex].toBase58();
    expect(budgetProgram).toBe('ComputeBudget111111111111111111111111111111');
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
    it('grosses the net output back up and rounds the fee up', () => {
      // net 990000 at 50 bps (5000 ppm): fee = ceil(990000 * 5000 / 995000) = 4975
      expect(service.estimateFeeAmount('990000', 50)).toBe('4975');
      expect(service.estimateFeeAmount('1', 50)).toBe('1');
      expect(service.estimateFeeAmount('0', 50)).toBe('0');
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
