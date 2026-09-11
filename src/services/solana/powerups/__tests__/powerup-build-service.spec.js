'use strict';

const mockConnection = {
  getMultipleAccountsInfo: jest.fn(),
  getLatestBlockhash: jest.fn(),
  getRecentPrioritizationFees: jest.fn(),
  simulateTransaction: jest.fn(),
};
jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return { ...actual, Connection: jest.fn(() => mockConnection) };
});
jest.mock('../../../shared/network-capabilities-service', () => ({ getPowerups: jest.fn() }));

const mockAdapter = { validate: jest.fn(), build: jest.fn() };
jest.mock('../registry', () => ({
  POWERUPS: {
    swap: { tier: 'core', networks: ['solana-mainnet'], contributor: null, endpoints: [] },
    fixture: {
      tier: 'community',
      networks: ['solana-mainnet'],
      contributor: { name: 'Fixture Labs', url: 'https://fixture.example' },
      programIds: ['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'],
      adapter: mockAdapter,
    },
    readonly: { tier: 'community', networks: ['solana-mainnet'], contributor: null, endpoints: [] },
  },
}));

const { PublicKey, TransactionInstruction, VersionedTransaction } = require('@solana/web3.js');
const networkCapabilitiesService = require('../../../shared/network-capabilities-service');
const service = require('../powerup-build-service');

const PAYER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const OTHER = 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m';
const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
const locals = { network: { id: 'solana-mainnet', config: { nodeUrl: 'http://rpc.test' } } };

const instruction = (programId) =>
  new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [{ pubkey: new PublicKey(PAYER), isSigner: true, isWritable: true }],
    data: Buffer.from('hi'),
  });

const stage = (powerups) => networkCapabilitiesService.getPowerups.mockReturnValue(powerups);

describe('powerup-build-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SWAP_PRIORITY_FEE_MICROLAMPORTS;
    stage({ swap: { enabled: true }, fixture: { enabled: true }, readonly: { enabled: true } });
    mockAdapter.validate.mockReturnValue({ params: { note: 'hi' } });
    mockAdapter.build.mockResolvedValue({
      instructions: [instruction(MEMO)],
      provider: { id: 'memo', displayName: 'Memo', attribution: 'Powered by Memo' },
      display: { note: 'hi' },
    });
    mockConnection.getLatestBlockhash.mockResolvedValue({ blockhash: BLOCKHASH });
    mockConnection.getRecentPrioritizationFees.mockResolvedValue([]);
    mockConnection.simulateTransaction.mockResolvedValue({
      value: { err: null, unitsConsumed: 10000, logs: [] },
    });
  });

  it('returns an UNSIGNED v0 transaction paid by the caller with the contributor and display fields', async () => {
    const result = await service.build('fixture', { publicKey: PAYER, note: 'hi' }, locals);

    expect(mockAdapter.validate).toHaveBeenCalledWith({ publicKey: PAYER, note: 'hi' });
    expect(mockAdapter.build).toHaveBeenCalledWith(
      { note: 'hi' },
      { locals, connection: mockConnection }
    );
    const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
    expect(tx.version).toBe(0);
    expect(tx.signatures.every((sig) => sig.every((byte) => byte === 0))).toBe(true);
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(PAYER);
    const programs = tx.message.compiledInstructions.map((ix) =>
      tx.message.staticAccountKeys[ix.programIdIndex].toBase58()
    );
    expect(programs).toEqual([
      'ComputeBudget111111111111111111111111111111',
      'ComputeBudget111111111111111111111111111111',
      MEMO,
    ]);
    expect(result).toMatchObject({
      provider: { id: 'memo', displayName: 'Memo', attribution: 'Powered by Memo' },
      salmonFee: null,
      contributor: { name: 'Fixture Labs', url: 'https://fixture.example' },
      priorityFeeMicroLamports: 1000,
      computeUnitLimit: 11500,
      display: { note: 'hi' },
    });
    expect(result.expiresAt).toEqual(expect.any(String));
  });

  it('passes an adapter-reported fee through untouched', async () => {
    const salmonFee = { amount: '5', mint: MEMO, side: 'input', bps: 50 };
    mockAdapter.build.mockResolvedValue({ instructions: [instruction(MEMO)], salmonFee });

    expect((await service.build('fixture', { publicKey: PAYER }, locals)).salmonFee).toEqual(
      salmonFee
    );
  });

  it.each([
    ['an unknown id', 'nope', locals],
    ['swap (stays on /ft/swap/build)', 'swap', locals],
    ['a read-only Powerup', 'readonly', locals],
    ['a network the Powerup is not declared for', 'fixture', { network: { id: 'solana-devnet' } }],
  ])('answers 404 not_found for %s', async (_label, id, requestLocals) => {
    await expect(service.build(id, { publicKey: PAYER }, requestLocals)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'not_found',
    });
    expect(mockAdapter.build).not.toHaveBeenCalled();
  });

  it('answers 404 not_found when the stage disables the Powerup', async () => {
    stage({ fixture: { enabled: false, reason: 'maintenance' } });

    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'not_found',
    });
  });

  it('answers 503 when the stage powerups block is invalid', async () => {
    stage(undefined);

    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'network_catalog_unavailable',
    });
  });

  it.each(['missing_parameter', 'invalid_parameter'])(
    'answers 400 %s from the adapter before any build',
    async (error) => {
      mockAdapter.validate.mockReturnValue({ error, error_description: 'note is required' });

      await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
        statusCode: 400,
        errorCode: error,
        message: 'note is required',
      });
      expect(mockAdapter.build).not.toHaveBeenCalled();
      expect(mockConnection.simulateTransaction).not.toHaveBeenCalled();
    }
  );

  it('refuses an instruction for an undeclared program with 502 and logs [POWERUP_PROGRAM_MISMATCH]', async () => {
    mockAdapter.build.mockResolvedValue({ instructions: [instruction(MEMO), instruction(OTHER)] });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'provider_program_mismatch',
    });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[POWERUP_PROGRAM_MISMATCH]'), {
      powerup: 'fixture',
      programId: OTHER,
    });
    expect(mockConnection.simulateTransaction).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('answers 422 simulation_failed with the runtime message instead of returning bytes', async () => {
    mockConnection.simulateTransaction.mockResolvedValue({
      value: { err: { InstructionError: [0, 'Custom'] }, logs: ['Program log: nope'] },
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'simulation_failed',
      message: expect.stringContaining('InstructionError'),
    });
    warn.mockRestore();
  });

  it('lets an upstream failure from the adapter propagate unchanged', async () => {
    const upstream = Object.assign(new Error('circuit open'), {
      statusCode: 503,
      errorCode: 'upstream_unavailable',
    });
    mockAdapter.build.mockRejectedValue(upstream);

    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toBe(upstream);
  });
});
