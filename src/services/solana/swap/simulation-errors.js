'use strict';

/**
 * What a rejected simulation means to the user (spec 018). The runtime says
 * only "instruction N failed with custom error 0x…"; the program that failed
 * and its own error table say why. Read here into the public codes the
 * client has copy for, so "slippage exceeded" and "not enough SOL for the
 * fee" never reach the user as a bare "would fail on-chain".
 *
 * Jupiter's codes come from its published IDL (`jup-ag/jupiter-cpi`,
 * fetched 2026-10-01); the SPL Token and System program ones are the
 * runtime's own. Anything unknown stays the generic 422 `simulation_failed`.
 */

const { SolanaSwapError } = require('./solana-swap-errors');

const JUPITER_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/** Jupiter v6 custom errors → [status, code, message]. Omitted codes are the generic 422. */
const JUPITER_CODES = {
  6000: [404, 'no_route', 'The route is empty; no venue can fill this pair right now.'],
  6001: [
    422,
    'slippage_exceeded',
    'The price moved past the slippage tolerance before the swap could settle.',
  ],
  6003: [500, 'swap_misconfigured', 'The platform fee account is missing.'],
  6004: [500, 'swap_misconfigured', 'The slippage sent to the router is invalid.'],
  6011: [500, 'swap_misconfigured', 'The referral authority is invalid.'],
  6012: [500, 'swap_misconfigured', 'The fee token account does not match the ledger.'],
  6014: [500, 'swap_misconfigured', 'The token program sent to the router is invalid.'],
  6016: [422, 'token_not_supported', 'The router does not support swapping this token.'],
};

/** SPL Token (and Token-2022) custom errors that mean something to the user. */
const TOKEN_CODES = {
  1: [422, 'insufficient_funds', 'The wallet does not hold enough of the token to swap.'],
};

const PROGRAM_TABLES = {
  [JUPITER_PROGRAM]: JUPITER_CODES,
  [TOKEN_PROGRAM]: TOKEN_CODES,
  [TOKEN_2022_PROGRAM]: TOKEN_CODES,
};

const INSUFFICIENT_SOL = [
  422,
  'insufficient_sol',
  'The wallet does not hold enough SOL for the network fee and the token accounts the swap opens.',
];

const FAILED_LOG = /^Program (\S+) failed: custom program error: 0x([0-9a-f]+)$/i;

/** The last program that reported a custom error in the logs, with its code. */
const failedProgramOf = (logs = []) => {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const match = FAILED_LOG.exec(logs[i]);
    if (match) return { program: match[1], code: parseInt(match[2], 16) };
  }
  return null;
};

const errorName = (err) => {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') return Object.keys(err)[0] || '';
  return '';
};

/**
 * @param {{ err: unknown, logs?: string[], transport?: boolean }} simulation
 * @returns {SolanaSwapError|null} a specific public error, or null for the generic one.
 */
const classifySimulationError = (simulation) => {
  if (!simulation?.err || simulation.transport) return null;
  const logs = simulation.logs || [];
  const name = errorName(simulation.err);
  const make = ([status, code, message]) => {
    const error = new SolanaSwapError(message, status, code);
    error.logs = logs;
    return error;
  };

  if (/^InsufficientFundsFor(Fee|Rent)$/.test(name) || name === 'AccountNotFound') {
    return make(INSUFFICIENT_SOL);
  }
  if (logs.some((line) => /insufficient lamports/i.test(line))) {
    return make(INSUFFICIENT_SOL);
  }
  const failed = failedProgramOf(logs);
  if (failed) {
    if (failed.program === SYSTEM_PROGRAM && failed.code === 1) return make(INSUFFICIENT_SOL);
    const table = PROGRAM_TABLES[failed.program];
    const row = table && table[failed.code];
    if (row) {
      if (row[0] === 500) {
        console.error('[SWAP_MISCONFIGURED] the simulation refused our own parameters', {
          program: failed.program,
          code: failed.code,
          message: row[2],
        });
      }
      return make(row);
    }
  }
  if (logs.some((line) => /Error: insufficient funds/i.test(line))) {
    return make(TOKEN_CODES[1]);
  }
  return null;
};

module.exports = { classifySimulationError, JUPITER_CODES, TOKEN_CODES, failedProgramOf };
