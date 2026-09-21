'use strict';

const { PublicKey, TransactionInstruction, VersionedTransaction } = require('@solana/web3.js');
const builder = require('../unsigned-transaction-builder');

const PAYER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
// The returned message invokes it, so the simulated message must too.
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const CLOSER = 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m';
const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

const instruction = (programId) =>
  new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [{ pubkey: new PublicKey(PAYER), isSigner: true, isWritable: true }],
    data: Buffer.from([1]),
  });

const connection = {
  getMultipleAccountsInfo: jest.fn(),
  getLatestBlockhash: jest.fn(),
  getRecentPrioritizationFees: jest.fn(),
  simulateTransaction: jest.fn(),
};

describe('unsigned-transaction-builder compileUnsigned', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POWERUP_PRIORITY_FEE_MICROLAMPORTS = '500';
    connection.getLatestBlockhash.mockResolvedValue({ blockhash: BLOCKHASH });
    connection.simulateTransaction.mockResolvedValue({
      value: { err: null, unitsConsumed: 1000, logs: [] },
    });
  });

  afterAll(() => delete process.env.POWERUP_PRIORITY_FEE_MICROLAMPORTS);

  // The compute-budget instructions cost a fixed 300 units (150 each, measured
  // against mainnet). Simulating without them derives the limit from a message
  // that is not the one returned, and the proportional headroom then has to
  // cover that fixed cost out of 15% of everything else — which it cannot for
  // any build under ~2000 units. A 1-byte memo simulates at 1773: limit 2039,
  // actual 2073, ProgramFailedToComplete on chain with the fee charged.
  it('simulates the compute-budget instructions it returns', async () => {
    const built = await builder.compileUnsigned({
      connection,
      payer: PAYER,
      instructions: [instruction(MEMO)],
    });

    const simulatedTx = connection.simulateTransaction.mock.calls[0][0];
    const keys = simulatedTx.message.getAccountKeys({ addressLookupTableAccounts: [] });
    const simulatedPrograms = simulatedTx.message.compiledInstructions.map((ix) =>
      keys.get(ix.programIdIndex).toBase58()
    );

    // Two budget instructions, ahead of the caller's — the returned shape.
    expect(simulatedPrograms).toEqual([COMPUTE_BUDGET, COMPUTE_BUDGET, MEMO]);

    const returned = VersionedTransaction.deserialize(Buffer.from(built.transaction, 'base64'));
    expect(returned.message.compiledInstructions).toHaveLength(
      simulatedTx.message.compiledInstructions.length
    );
  });

  it('drops the cleanup, logs [CLEANUP_SKIPPED] and re-simulates when the close is rejected', async () => {
    connection.simulateTransaction
      .mockResolvedValueOnce({ value: { err: { InstructionError: [1, 'Custom'] }, logs: ['x'] } })
      .mockResolvedValueOnce({ value: { err: null, unitsConsumed: 1000, logs: [] } });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const built = await builder.compileUnsigned({
      connection,
      payer: PAYER,
      instructions: [instruction(MEMO)],
      cleanup: [instruction(CLOSER)],
    });

    expect(connection.simulateTransaction).toHaveBeenCalledTimes(2);
    expect(built.cleanup).toEqual([]);
    expect(built.programIds).toEqual([...builder.ALWAYS_ALLOWED_PROGRAMS, MEMO]);
    const tx = VersionedTransaction.deserialize(Buffer.from(built.transaction, 'base64'));
    expect(tx.message.compiledInstructions).toHaveLength(3);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[CLEANUP_SKIPPED]'),
      expect.objectContaining({ accounts: 1 })
    );
    warn.mockRestore();
  });

  it('returns no bytes and the failed simulation when the fallback is off', async () => {
    connection.simulateTransaction.mockResolvedValue({
      value: { err: { InstructionError: [0, 'Custom'] }, logs: [] },
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const built = await builder.compileUnsigned({
      connection,
      payer: PAYER,
      instructions: [instruction(MEMO)],
      simulationFallback: false,
    });

    expect(built.transaction).toBeNull();
    expect(built.simulation.err).toEqual({ InstructionError: [0, 'Custom'] });
    expect(built.programIds).toEqual([COMPUTE_BUDGET, MEMO]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('marks a transport failure so callers do not blame the transaction', async () => {
    connection.simulateTransaction.mockRejectedValue(new Error('rpc down'));

    const built = await builder.compileUnsigned({
      connection,
      payer: PAYER,
      instructions: [instruction(MEMO)],
      simulationFallback: false,
    });

    expect(built.simulation).toEqual({ err: 'rpc down', transport: true, logs: [] });
  });
});
