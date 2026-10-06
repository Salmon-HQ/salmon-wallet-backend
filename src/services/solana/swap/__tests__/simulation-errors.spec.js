'use strict';

const { classifySimulationError, failedProgramOf } = require('../simulation-errors');

const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM = '11111111111111111111111111111111';

const custom = (index, code, program, extra = []) => ({
  err: { InstructionError: [index, { Custom: code }] },
  logs: [
    `Program ${program} invoke [1]`,
    ...extra,
    `Program ${program} failed: custom program error: 0x${code.toString(16)}`,
  ],
});

describe('simulation-errors — what a rejected simulation means to the user', () => {
  let error;
  beforeEach(() => {
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => error.mockRestore());

  it('reads the failing program and code off the logs', () => {
    expect(failedProgramOf(custom(4, 6001, JUP).logs)).toEqual({ program: JUP, code: 6001 });
    expect(failedProgramOf(['Program log: hi'])).toBeNull();
  });

  it.each([
    [6000, 404, 'no_route'],
    [6001, 422, 'slippage_exceeded'],
    [6003, 500, 'swap_misconfigured'],
    [6004, 500, 'swap_misconfigured'],
    [6011, 500, 'swap_misconfigured'],
    [6012, 500, 'swap_misconfigured'],
    [6014, 500, 'swap_misconfigured'],
    [6016, 422, 'token_not_supported'],
  ])('maps Jupiter custom error %i onto %i %s', (code, statusCode, errorCode) => {
    const result = classifySimulationError(custom(4, code, JUP));
    expect(result).toMatchObject({ statusCode, errorCode });
    expect(result.logs).toHaveLength(2);
    if (statusCode === 500) expect(error).toHaveBeenCalled();
  });

  it.each([6002, 6005, 6006, 6007, 6008, 6009, 6010, 6013, 6015, 6017])(
    'leaves Jupiter error %i to the generic simulation failure',
    (code) => {
      expect(classifySimulationError(custom(4, code, JUP))).toBeNull();
    }
  );

  it('maps the SPL Token insufficient-funds error, by code and by log line', () => {
    expect(classifySimulationError(custom(3, 1, TOKEN))).toMatchObject({
      statusCode: 422,
      errorCode: 'insufficient_funds',
    });
    expect(
      classifySimulationError({
        err: { InstructionError: [3, 'Custom'] },
        logs: ['Program log: Error: insufficient funds'],
      })
    ).toMatchObject({ errorCode: 'insufficient_funds' });
  });

  it('maps every way the runtime says "not enough SOL"', () => {
    for (const simulation of [
      { err: 'InsufficientFundsForFee', logs: [] },
      { err: { InsufficientFundsForRent: { account_index: 2 } }, logs: [] },
      { err: 'AccountNotFound', logs: [] },
      custom(1, 1, SYSTEM),
      {
        err: { InstructionError: [1, { Custom: 1 }] },
        logs: ['Transfer: insufficient lamports 100, need 2039280'],
      },
    ]) {
      expect(classifySimulationError(simulation)).toMatchObject({
        statusCode: 422,
        errorCode: 'insufficient_sol',
      });
    }
  });

  it("maps 0x Settler's 7001 (the taker does not hold the input) onto insufficient_funds", () => {
    expect(
      classifySimulationError(custom(5, 7001, 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m'))
    ).toMatchObject({ statusCode: 422, errorCode: 'insufficient_funds' });
    expect(
      classifySimulationError(custom(5, 7002, 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m'))
    ).toBeNull();
  });

  it('answers null for a transport failure, no error, or an unknown program', () => {
    expect(classifySimulationError({ err: 'ECONNRESET', transport: true, logs: [] })).toBeNull();
    expect(classifySimulationError({ err: null, logs: [] })).toBeNull();
    expect(
      classifySimulationError(custom(2, 6001, 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m'))
    ).toBeNull();
  });
});
