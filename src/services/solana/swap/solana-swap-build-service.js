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
 * callers cannot influence it. The fee is taken from the OUTPUT token, so the
 * recipient is the owner's associated token account for the output mint (the
 * owner's wallet itself when the output is native SOL). 0x does not create
 * fee accounts, so a missing one is a 503, never a fee-less swap.
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
const zeroex = require('./zeroex-swap-provider');
const {
  SolanaSwapFeeAccountMissingError,
  SolanaSwapFeeMismatchError,
} = require('./solana-swap-errors');

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

const priorityFeeMicroLamports = () => Number(process.env.SWAP_PRIORITY_FEE_MICROLAMPORTS) || 0;

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
 * Salmon's fee recipient for `outputMint`, verified to exist on-chain.
 * Native SOL output pays the owner wallet directly; any token pays the
 * owner's ATA under the mint's own token program (SPL or Token-2022).
 */
const resolveFeeRecipient = async (connection, fee, outputMint) => {
  if (!fee) {
    return null;
  }
  if (outputMint === SOL_ADDRESS) {
    return fee.owner;
  }

  const mint = new PublicKey(outputMint);
  const mintInfo = await connection.getAccountInfo(mint, COMMITMENT);
  if (!mintInfo) {
    throw new SolanaSwapFeeAccountMissingError('(unknown mint program)', outputMint);
  }
  const ata = getAssociatedTokenAddressSync(mint, new PublicKey(fee.owner), false, mintInfo.owner);
  const ataInfo = await connection.getAccountInfo(ata, COMMITMENT);
  if (!ataInfo) {
    throw new SolanaSwapFeeAccountMissingError(ata.toBase58(), outputMint);
  }
  return ata.toBase58();
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

/**
 * Fee 0x deducted from the output. `amountOut` is already net of the buy-side
 * fee, and 0x rounds the fee up, so gross = net + ceil(gross * ppm / 1e6)
 * ⇒ fee = ceil(net * ppm / (1e6 - ppm)).
 */
const estimateFeeAmount = (amountOut, bps) => {
  const ppm = BigInt(bps * zeroex.PPM_PER_BPS);
  const million = 1000000n;
  const net = BigInt(amountOut);
  return String((net * ppm + (million - ppm) - 1n) / (million - ppm));
};

/**
 * Build an unsigned swap transaction.
 *
 * @param {Object} params - validated by the controller: `inputMint`, `outputMint`,
 *   `amount` (base units), `publicKey` (taker), `slippageBps`.
 * @param {Object} locals - request locals (`network.config.nodeUrl`).
 * @returns {Promise<Object>} build result consumed by `solana-swap-build-resource`.
 */
const build = async ({ inputMint, outputMint, amount, publicKey, slippageBps }, locals) => {
  const connection = new Connection(locals.network.config.nodeUrl, COMMITMENT);
  const fee = feeConfig();
  const feeRecipient = await resolveFeeRecipient(connection, fee, outputMint);
  const priorityFee = priorityFeeMicroLamports();

  const quote = await zeroex.requestSwapInstructions({
    inputMint,
    outputMint,
    amount,
    taker: publicKey,
    slippageBps,
    fee: feeRecipient ? { recipient: feeRecipient, bps: fee.bps } : null,
    reserveBytes: priorityFee > 0 ? COMPUTE_BUDGET_RESERVE_BYTES : 0,
  });

  assertFeeInstructionPresent(quote.instructions, feeRecipient);

  const [lookupTables, { blockhash }] = await Promise.all([
    fetchLookupTables(connection, quote.lookupTableAddresses),
    connection.getLatestBlockhash(COMMITMENT),
  ]);

  const instructions =
    priorityFee > 0
      ? [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
          ...quote.instructions,
        ]
      : quote.instructions;

  const message = new TransactionMessage({
    payerKey: new PublicKey(publicKey),
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);
  const transaction = Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');

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
    routePlan: quote.routePlan,
    salmonFee: feeRecipient
      ? { amount: estimateFeeAmount(quote.amountOut, fee.bps), mint: outputMint, bps: fee.bps }
      : null,
  };
};

module.exports = { build, resolveAmount, resolveSlippage, estimateFeeAmount, PROVIDER };
