'use strict';

/**
 * Instructions → UNSIGNED v0 transaction, shared by every Powerup build
 * (the swap on `/ft/swap/build`, the generic `/powerups/:id/build`).
 *
 * One compile step so every builder pays the same priority fee, gets the
 * same compute-unit limit and is simulated the same way: address lookup
 * tables + blockhash + priority fee (`SWAP_PRIORITY_FEE_MICROLAMPORTS` pins
 * it; unset follows the network), a compute-unit limit from simulation, the
 * caller as fee payer, zero signatures. Nothing here signs or broadcasts
 * (root `AGENTS.md` "Signing boundary").
 *
 * Optional `cleanup` instructions (a swap's intermediate-account closes) are
 * appended, then dropped when the simulation rejects them so the main
 * instructions still ship.
 */

const {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} = require('@solana/web3.js');

const COMMITMENT = 'confirmed';
/** A blockhash stays valid for ~150 slots; tell the client when to ask for a fresh build. */
const BUILD_TTL_MS = 60 * 1000;

/** Bounds for the dynamic priority fee (micro-lamports per compute unit). */
const PRIORITY_FEE_MIN = 1000;
const PRIORITY_FEE_MAX = 20000;
/** Headroom over the simulated compute units; fallback when simulation is unavailable. */
const COMPUTE_UNIT_HEADROOM = 1.15;
const COMPUTE_UNIT_FALLBACK = 400000;
/** getRecentPrioritizationFees accepts at most this many accounts. */
const PRIORITY_FEE_MAX_ACCOUNTS = 128;

/**
 * Priority fee in micro-lamports per compute unit. `SWAP_PRIORITY_FEE_MICROLAMPORTS`
 * pins it (0 disables); unset, it follows the network: the 75th percentile of
 * the recent fees paid on the accounts this transaction writes to (zeros
 * included — an uncongested network must read as cheap), clamped to
 * [PRIORITY_FEE_MIN, PRIORITY_FEE_MAX]. With the simulated CU limit (~150k
 * for a typical swap) the clamp range costs the user 0.00015–0.003 SOL.
 * A failed RPC read falls back to the minimum.
 */
const resolvePriorityFee = async (connection, instructions) => {
  const pinned = process.env.SWAP_PRIORITY_FEE_MICROLAMPORTS;
  if (pinned !== undefined && pinned !== '') {
    return Math.max(0, Number(pinned) || 0);
  }
  const writable = [
    ...new Set(
      instructions.flatMap((ix) =>
        ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey.toBase58())
      )
    ),
  ]
    .slice(0, PRIORITY_FEE_MAX_ACCOUNTS)
    .map((address) => new PublicKey(address));
  try {
    const recent = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: writable,
    });
    const fees = recent.map((entry) => entry.prioritizationFee).sort((a, b) => a - b);
    const p75 = fees.length > 0 ? fees[Math.floor(0.75 * (fees.length - 1))] : 0;
    return Math.min(PRIORITY_FEE_MAX, Math.max(PRIORITY_FEE_MIN, p75));
  } catch (error) {
    console.warn(
      `Swap build: recent prioritization fees unavailable (${error.message}); using minimum`
    );
    return PRIORITY_FEE_MIN;
  }
};

/**
 * Simulate the unsigned message. `{ units }` on success, `{ err }` when the
 * runtime rejected it (logs kept for the caller's warning), `{ err }` with
 * the transport message when the RPC could not simulate at all.
 */
const simulate = async (connection, message) => {
  try {
    const { value } = await connection.simulateTransaction(new VersionedTransaction(message), {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    if (value.err || !value.unitsConsumed) {
      return { err: value.err || 'no compute units reported', logs: (value.logs || []).slice(-3) };
    }
    return { units: value.unitsConsumed };
  } catch (error) {
    return { err: error.message, logs: [] };
  }
};

/**
 * Compute-unit limit: the simulated units plus headroom. Without a limit the
 * runtime budgets 200k CU per instruction and the priority fee is charged on
 * that budget, not on what runs (probed: a 3-instruction swap consumed ~135k
 * of a 785k default budget). A failed simulation (e.g. the taker cannot fund
 * the swap yet) falls back to a fixed limit so a quote is still returned;
 * the wallet simulates again before signing.
 */
const computeUnitLimitFrom = (simulation) => {
  if (simulation.err) {
    console.warn('Swap build: simulation did not yield compute units', simulation);
    return COMPUTE_UNIT_FALLBACK;
  }
  return Math.ceil(simulation.units * COMPUTE_UNIT_HEADROOM);
};

const fetchLookupTables = async (connection, addresses) => {
  if (addresses.length === 0) {
    return [];
  }
  const keys = addresses.map((address) => new PublicKey(address));
  const infos = await connection.getMultipleAccountsInfo(keys, COMMITMENT);
  return infos.map((info, index) => {
    if (!info) {
      throw new Error(`Address lookup table ${addresses[index]} not found`);
    }
    return new AddressLookupTableAccount({
      key: keys[index],
      state: AddressLookupTableAccount.deserialize(info.data),
    });
  });
};

/**
 * Compile `instructions` into a serialized, unsigned v0 transaction paid by
 * `payer`, with a compute budget (limit + price) prepended when the priority
 * fee is non-zero.
 *
 * @param {Object} input
 * @param {import('@solana/web3.js').Connection} input.connection
 * @param {string} input.payer - fee payer (the caller's wallet)
 * @param {import('@solana/web3.js').TransactionInstruction[]} input.instructions
 * @param {string[]} [input.lookupTableAddresses]
 * @param {import('@solana/web3.js').TransactionInstruction[]} [input.cleanup] - appended
 *   after `instructions`; dropped when the simulation rejects them
 * @returns {Promise<{ transaction: string, priorityFeeMicroLamports: number,
 *   computeUnitLimit: number|null, simulation: Object, cleanup: Array }>} base64
 *   bytes, the budget applied, the (final) simulation and the cleanup kept
 */
const compileUnsigned = async ({
  connection,
  payer,
  instructions,
  lookupTableAddresses = [],
  cleanup = [],
}) => {
  const [lookupTables, { blockhash }, priorityFee] = await Promise.all([
    fetchLookupTables(connection, lookupTableAddresses),
    connection.getLatestBlockhash(COMMITMENT),
    resolvePriorityFee(connection, instructions),
  ]);

  const compile = (ixs) =>
    new TransactionMessage({
      payerKey: new PublicKey(payer),
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(lookupTables);

  let applied = cleanup;
  let simulation = await simulate(connection, compile([...instructions, ...applied]));
  if (simulation.err && applied.length > 0) {
    console.warn('[SWAP_CLEANUP_SKIPPED] intermediate account close rejected in simulation', {
      accounts: applied.length,
      err: simulation.err,
      logs: simulation.logs,
    });
    applied = [];
    simulation = await simulate(connection, compile(instructions));
  }
  const computeUnitLimit = computeUnitLimitFrom(simulation);
  const budget =
    priorityFee > 0
      ? [
          ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
        ]
      : [];
  const transaction = Buffer.from(
    new VersionedTransaction(compile([...budget, ...instructions, ...applied])).serialize()
  ).toString('base64');

  return {
    transaction,
    priorityFeeMicroLamports: priorityFee,
    computeUnitLimit: priorityFee > 0 ? computeUnitLimit : null,
    simulation,
    cleanup: applied,
  };
};

module.exports = {
  BUILD_TTL_MS,
  COMMITMENT,
  compileUnsigned,
  computeUnitLimitFrom,
  fetchLookupTables,
  resolvePriorityFee,
  simulate,
};
