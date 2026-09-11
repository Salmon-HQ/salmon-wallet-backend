'use strict';

/**
 * Solana swap build service — quote → UNSIGNED transaction.
 *
 * Orchestrates one swap build: validates the amount, resolves Salmon's fee
 * recipient for the output mint, asks the provider (0x) for instructions,
 * assembles a v0 `VersionedTransaction` (lookup tables + blockhash + priority
 * fee) with the user as fee payer, checks the fee is in it, and returns the
 * serialized bytes. Nothing here signs or broadcasts: the wallet does both
 * (root `AGENTS.md` "Signing boundary").
 *
 * Fee policy is server-side only (`SWAP_FEE_BPS`, `SWAP_FEE_ACCOUNT_OWNER`);
 * callers cannot influence it. The fee is paid to the owner's associated
 * token account for the fee mint (the owner's wallet itself for native SOL).
 * 0x does not create fee accounts, so the side is chosen by which account
 * exists: the OUTPUT token when its account exists (`buy`), else the INPUT
 * token (`sell`), else the swap is built WITHOUT a fee and a greppable error
 * is logged — the user is never blocked by Salmon's own ops gap.
 */

const {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} = require('@solana/web3.js');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
const { SOL_ADDRESS, SOL_DECIMALS } = require('../../../constants/solana-constants');
const { getByMints } = require('../solana-ft-service');
const tokenMetadata = require('../token-metadata-service');
const zeroex = require('./zeroex-swap-provider');
const { SolanaSwapError, SolanaSwapFeeMismatchError } = require('./solana-swap-errors');

const PROVIDER = { id: '0x', displayName: '0x', attribution: 'Powered by 0x' };
const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_SLIPPAGE_BPS = 10000;
/** Bytes 0x leaves free for the ComputeBudget instructions we prepend (docs' worked example). */
const COMPUTE_BUDGET_RESERVE_BYTES = 52;
/** A blockhash stays valid for ~150 slots; tell the client when to ask for a fresh build. */
const BUILD_TTL_MS = 60 * 1000;
const COMMITMENT = 'confirmed';

const feeConfig = () => {
  const bps = Number.parseInt(process.env.SWAP_FEE_BPS, 10);
  const owner = process.env.SWAP_FEE_ACCOUNT_OWNER;
  return Number.isInteger(bps) && bps > 0 && owner ? { bps, owner } : null;
};

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
 * the recent fees paid on the accounts this swap writes to (zeros included —
 * an uncongested network must read as cheap), clamped to
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
 * Resolve the base-unit `amount` from either a raw `amount` or a
 * human-readable `uiAmount` (decimals looked up in the token catalog; SOL
 * short-circuits). Returns `{ amount }` or a 400 error envelope.
 */
const resolveAmount = async ({ amount, uiAmount, inputMint }, locals) => {
  if (amount !== undefined) {
    const numeric = Number(amount);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      return {
        error: 'invalid_parameter',
        error_description: 'amount must be a positive integer in the token smallest unit',
      };
    }
    return { amount: String(amount) };
  }

  if (!uiAmount) {
    return {
      error: 'missing_parameter',
      error_description: 'Either `amount` (raw) or `uiAmount` (human-readable) is required',
    };
  }

  const numeric = Number(uiAmount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { error: 'invalid_parameter', error_description: 'uiAmount must be a positive number' };
  }

  let decimals = SOL_DECIMALS;
  if (inputMint !== SOL_ADDRESS) {
    const tokens = await getByMints([inputMint], locals);
    const token = tokens.find((t) => (t.id || t.address) === inputMint);
    if (!token || typeof token.decimals !== 'number') {
      return {
        error: 'unknown_mint',
        error_description: `Could not resolve decimals for inputMint=${inputMint}`,
      };
    }
    decimals = token.decimals;
  }

  // Math.round avoids 1.5 * 10^9 = 1499999999.9999998 rounding artefacts.
  return { amount: String(Math.round(numeric * Math.pow(10, decimals))) };
};

/** `{ slippageBps }` (default 50) or a 400 error envelope. */
const resolveSlippage = (slippageBps) => {
  if (slippageBps === undefined) {
    return { slippageBps: DEFAULT_SLIPPAGE_BPS };
  }
  const numeric = Number(slippageBps);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > MAX_SLIPPAGE_BPS) {
    return {
      error: 'invalid_parameter',
      error_description: `slippageBps must be an integer between 0 and ${MAX_SLIPPAGE_BPS}`,
    };
  }
  return { slippageBps: numeric };
};

/**
 * Salmon's fee account for `mint`, or null when it does not exist on-chain.
 * Native SOL pays the owner wallet directly; any token pays the owner's ATA
 * under the mint's own token program (SPL or Token-2022).
 */
const existingFeeAccount = async (connection, owner, mint) => {
  if (mint === SOL_ADDRESS) {
    return owner;
  }
  const mintKey = new PublicKey(mint);
  const mintInfo = await connection.getAccountInfo(mintKey, COMMITMENT);
  if (!mintInfo) {
    return null;
  }
  const ata = getAssociatedTokenAddressSync(mintKey, new PublicKey(owner), false, mintInfo.owner);
  const ataInfo = await connection.getAccountInfo(ata, COMMITMENT);
  return ataInfo ? ata.toBase58() : null;
};

/**
 * Pick the fee side by which fee account exists: output (`buy`) first, then
 * input (`sell`). Returns null (no fee, logged) when neither exists.
 *
 * @returns {Promise<{ recipient: string, bps: number, side: 'buy'|'sell', mint: string }|null>}
 */
const resolveFee = async (connection, fee, inputMint, outputMint) => {
  if (!fee) {
    return null;
  }
  for (const [side, mint] of [
    ['buy', outputMint],
    ['sell', inputMint],
  ]) {
    const recipient = await existingFeeAccount(connection, fee.owner, mint);
    if (recipient) {
      return { recipient, bps: fee.bps, side, mint };
    }
  }
  console.error('[SWAP_FEE_SKIPPED] no fee token account for either side; swap built without fee', {
    owner: fee.owner,
    inputMint,
    outputMint,
    fix: 'create the owner ATA for one of these mints',
  });
  return null;
};

/**
 * Compute-unit limit for the swap: simulate the unsigned message and add
 * headroom. Without a limit the runtime budgets 200k CU per instruction and
 * the priority fee is charged on that budget, not on what runs (probed: a
 * 3-instruction swap consumed ~135k of a 785k default budget). A failed
 * simulation (e.g. the taker cannot fund the swap yet) falls back to a fixed
 * limit so a quote is still returned; the wallet simulates again before
 * signing.
 */
const resolveComputeUnitLimit = async (connection, message) => {
  try {
    const { value } = await connection.simulateTransaction(new VersionedTransaction(message), {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    if (value.err || !value.unitsConsumed) {
      console.warn('Swap build: simulation did not yield compute units', {
        err: value.err,
        logs: (value.logs || []).slice(-3),
      });
      return COMPUTE_UNIT_FALLBACK;
    }
    return Math.ceil(value.unitsConsumed * COMPUTE_UNIT_HEADROOM);
  } catch (error) {
    console.warn(`Swap build: simulation unavailable (${error.message}); using fallback CU limit`);
    return COMPUTE_UNIT_FALLBACK;
  }
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

/** The fee only exists if the provider wired the recipient into an instruction. */
const assertFeeInstructionPresent = (instructions, recipient) => {
  if (!recipient) {
    return;
  }
  const referenced = instructions.some((ix) =>
    ix.keys.some((k) => k.pubkey.toBase58() === recipient)
  );
  if (!referenced) {
    throw new SolanaSwapFeeMismatchError(recipient);
  }
};

const MILLION = 1000000n;
const ceilDiv = (a, b) => (a + b - 1n) / b;

/**
 * Fee 0x deducts, in the fee token's base units (0x rounds fees up).
 * `sell`: taken from the input before routing ⇒ ceil(amountIn * ppm / 1e6).
 * `buy`: `amountOut` is already net of it ⇒ gross = net + ceil(gross * ppm / 1e6)
 * ⇒ fee = ceil(net * ppm / (1e6 - ppm)).
 */
const estimateFeeAmount = ({ side, amountIn, amountOut, bps }) => {
  const ppm = BigInt(bps * zeroex.PPM_PER_BPS);
  if (side === 'sell') {
    return String(ceilDiv(BigInt(amountIn) * ppm, MILLION));
  }
  return String(ceilDiv(BigInt(amountOut) * ppm, MILLION - ppm));
};

/**
 * Build an unsigned swap transaction.
 *
 * @param {Object} params - validated by the controller: `inputMint`, `outputMint`,
 *   `amount` (base units), `publicKey` (taker), `slippageBps`.
 * @param {Object} locals - request locals (`network.config.nodeUrl`).
 * @returns {Promise<Object>} build result consumed by `solana-swap-build-resource`.
 */
/**
 * Refuse Token-2022 mints the router cannot trade (transfer fee, transfer
 * hook, non-transferable) before spending a provider call.
 * @throws {SolanaSwapError} 422 token_not_supported
 */
const assertRoutable = async (mints, locals) => {
  const tokens = await tokenMetadata.getByMints(mints, locals);
  for (const mint of mints) {
    const token = tokens.get(mint);
    if (token && token.swappable === false) {
      throw new SolanaSwapError(
        `${token.symbol || mint} carries a Token-2022 extension the router cannot trade (transfer fee or hook)`,
        422,
        'token_not_supported'
      );
    }
  }
};

const build = async ({ inputMint, outputMint, amount, publicKey, slippageBps }, locals) => {
  await assertRoutable([inputMint, outputMint], locals);
  const connection = new Connection(locals.network.config.nodeUrl, COMMITMENT);
  const fee = await resolveFee(connection, feeConfig(), inputMint, outputMint);

  const quote = await zeroex.requestSwapInstructions({
    inputMint,
    outputMint,
    amount,
    taker: publicKey,
    slippageBps,
    fee: fee ? { recipient: fee.recipient, bps: fee.bps, side: fee.side } : null,
    reserveBytes: COMPUTE_BUDGET_RESERVE_BYTES,
  });

  assertFeeInstructionPresent(quote.instructions, fee?.recipient);

  const [lookupTables, { blockhash }, priorityFee] = await Promise.all([
    fetchLookupTables(connection, quote.lookupTableAddresses),
    connection.getLatestBlockhash(COMMITMENT),
    resolvePriorityFee(connection, quote.instructions),
  ]);

  const compile = (instructions) =>
    new TransactionMessage({
      payerKey: new PublicKey(publicKey),
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTables);

  const computeUnitLimit = await resolveComputeUnitLimit(connection, compile(quote.instructions));
  const budget =
    priorityFee > 0
      ? [
          ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
        ]
      : [];
  const transaction = Buffer.from(
    new VersionedTransaction(compile([...budget, ...quote.instructions])).serialize()
  ).toString('base64');

  return {
    provider: PROVIDER,
    providerRequestId: quote.zid,
    transaction,
    expiresAt: new Date(Date.now() + BUILD_TTL_MS).toISOString(),
    inputMint,
    outputMint,
    amountIn: amount,
    amountOut: quote.amountOut,
    minAmountOut: quote.minAmountOut,
    slippageBps,
    priorityFeeMicroLamports: priorityFee,
    computeUnitLimit: priorityFee > 0 ? computeUnitLimit : null,
    routePlan: quote.routePlan,
    salmonFee: fee
      ? {
          amount: estimateFeeAmount({
            side: fee.side,
            amountIn: amount,
            amountOut: quote.amountOut,
            bps: fee.bps,
          }),
          mint: fee.mint,
          side: fee.side === 'sell' ? 'input' : 'output',
          bps: fee.bps,
        }
      : null,
  };
};

module.exports = { build, resolveAmount, resolveSlippage, estimateFeeAmount, PROVIDER };
