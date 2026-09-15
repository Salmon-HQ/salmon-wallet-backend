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
jest.mock('../powerup-catalog-service', () => ({ isOffered: jest.fn() }));

const mockAdapter = { validate: jest.fn(), build: jest.fn() };
jest.mock('../registry', () => ({
  POWERUPS: {
    fixture: {
      tier: 'community',
      networks: ['solana-mainnet'],
      contributor: { name: 'Fixture Labs', url: 'https://fixture.example' },
      programIds: ['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'],
      lookupTables: ['AddressLookupTab1e1111111111111111111111111'],
      errorCodes: ['note_too_long'],
      adapter: mockAdapter,
    },
    readonly: { tier: 'community', networks: ['solana-mainnet'], contributor: null, endpoints: [] },
  },
}));

const { PublicKey, TransactionInstruction, VersionedTransaction } = require('@solana/web3.js');
const powerupCatalog = require('../powerup-catalog-service');
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

const OFFERED = new Set(['fixture', 'readonly']);

describe('powerup-build-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.POWERUP_PRIORITY_FEE_MICROLAMPORTS;
    powerupCatalog.isOffered.mockImplementation(
      (id, networkId) => networkId === 'solana-mainnet' && OFFERED.has(id)
    );
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

  it('never publishes an adapter-reported fee: salmonFee is forced null', async () => {
    const salmonFee = { amount: '5', mint: MEMO, side: 'input', bps: 50 };
    mockAdapter.build.mockResolvedValue({ instructions: [instruction(MEMO)], salmonFee });

    expect((await service.build('fixture', { publicKey: PAYER }, locals)).salmonFee).toBeNull();
  });

  it.each([
    ['an unknown id', 'nope', locals],
    ['a read-only Powerup', 'readonly', locals],
    ['a network the Powerup is not declared for', 'fixture', { network: { id: 'solana-devnet' } }],
  ])('answers 404 not_found for %s', async (_label, id, requestLocals) => {
    await expect(service.build(id, { publicKey: PAYER }, requestLocals)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'not_found',
    });
    expect(mockAdapter.build).not.toHaveBeenCalled();
  });

  it('answers 404 not_found when the catalog does not offer the Powerup (stage or network off)', async () => {
    powerupCatalog.isOffered.mockReturnValue(false);

    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'not_found',
    });
    expect(powerupCatalog.isOffered).toHaveBeenCalledWith('fixture', 'solana-mainnet');
  });

  it('lets the catalog 503 through when the stage config is invalid', async () => {
    const unavailable = Object.assign(new Error('x'), {
      statusCode: 503,
      errorCode: 'network_catalog_unavailable',
    });
    powerupCatalog.isOffered.mockImplementation(() => {
      throw unavailable;
    });

    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toBe(unavailable);
  });

  it('passes an adapter-declared error code through and maps unknown codes to invalid_parameter', async () => {
    mockAdapter.validate.mockReturnValueOnce({
      error: 'note_too_long',
      error_description: 'max 32',
    });
    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'note_too_long',
      message: 'max 32',
    });

    mockAdapter.validate.mockReturnValueOnce({ error: 'whatever', error_description: 'bad' });
    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'invalid_parameter',
    });
  });

  it('refuses an undeclared lookup table with 502 before compiling', async () => {
    mockAdapter.build.mockResolvedValue({
      instructions: [instruction(MEMO)],
      lookupTableAddresses: ['AddressLookupTab1e2222222222222222222222222'],
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'provider_program_mismatch',
    });
    expect(mockConnection.getLatestBlockhash).not.toHaveBeenCalled();
    error.mockRestore();
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

  it('refuses a compiled message invoking an undeclared program with 502 and logs [POWERUP_PROGRAM_MISMATCH]', async () => {
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
    error.mockRestore();
  });

  it('resolves lookup-table programs before checking: an ALT-loaded program must be declared', async () => {
    const { AddressLookupTableAccount } = require('@solana/web3.js');
    const LOOKUP = 'AddressLookupTab1e1111111111111111111111111';
    // OTHER lives in the table only; the message references it by table index, not statically.
    jest.spyOn(AddressLookupTableAccount, 'deserialize').mockReturnValueOnce({
      deactivationSlot: BigInt('18446744073709551615'),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: [new PublicKey(OTHER)],
    });
    mockConnection.getMultipleAccountsInfo.mockResolvedValue([{ data: Buffer.alloc(56) }]);
    mockAdapter.build.mockResolvedValue({
      instructions: [
        instruction(MEMO),
        new TransactionInstruction({
          programId: new PublicKey(MEMO),
          keys: [{ pubkey: new PublicKey(OTHER), isSigner: false, isWritable: true }],
          data: Buffer.from('x'),
        }),
      ],
      lookupTableAddresses: [LOOKUP],
    });

    // OTHER is only an account here, never a program → allowed, and it is table-loaded.
    const result = await service.build('fixture', { publicKey: PAYER }, locals);
    const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
    expect(tx.message.addressTableLookups).toHaveLength(1);
    expect(tx.message.staticAccountKeys.map((k) => k.toBase58())).not.toContain(OTHER);
  });

  it('refuses a transaction that needs a signature besides the caller with 502 provider_signer_mismatch', async () => {
    const cosigner = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
    mockAdapter.build.mockResolvedValue({
      instructions: [
        new TransactionInstruction({
          programId: new PublicKey(MEMO),
          keys: [
            { pubkey: new PublicKey(PAYER), isSigner: true, isWritable: true },
            { pubkey: new PublicKey(cosigner), isSigner: true, isWritable: false },
          ],
          data: Buffer.from('hi'),
        }),
      ],
      display: {},
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'provider_signer_mismatch',
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[POWERUP_SIGNER_MISMATCH]'),
      expect.objectContaining({ powerup: 'fixture', requiredSignatures: 2 })
    );
    error.mockRestore();
  });

  it('never resolves a prototype key as a Powerup', async () => {
    for (const id of ['__proto__', 'constructor', 'toString']) {
      await expect(service.build(id, { publicKey: PAYER }, locals)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'not_found',
      });
    }
    expect(mockAdapter.build).not.toHaveBeenCalled();
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
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('answers 503 simulation_unavailable when the RPC could not simulate at all', async () => {
    mockConnection.simulateTransaction.mockRejectedValue(new Error('rpc down'));

    await expect(service.build('fixture', { publicKey: PAYER }, locals)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'simulation_unavailable',
    });
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
