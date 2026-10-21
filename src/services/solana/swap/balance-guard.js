'use strict';

/**
 * What a simulated swap does to the taker's own accounts, checked before the
 * bytes are returned — for every provider, 0x included.
 *
 * The instruction checks hold each instruction a provider sends to what a
 * swap needs, but the accounts the taker hands to the router's legs are
 * only as safe as the programs those legs reach. The simulation the build
 * already runs settles it: the taker's wallet and its token accounts in the
 * transaction are read before, their post-simulation state is asked for,
 * and the swap is refused when it moves the taker's funds beyond the swap:
 * a token account of another mint losing tokens, the input mint dropping by
 * more than the amount, SOL dropping by more than the amount (SOL input),
 * the fees and the rent of the accounts it creates, or a token account
 * changing owner or gaining a delegate or close authority.
 *
 * SOL is counted across the wallet and its token accounts, so wrapping SOL,
 * the rent of the taker's new accounts and unwrapping it back cancel out.
 */

const { PublicKey } = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const { SOL_ADDRESS } = require('../../../constants/solana-constants');
const { COMMITMENT } = require('../powerups/unsigned-transaction-builder');

/**
 * SPL token account layout, shared by both token programs: mint 0..32,
 * owner 32..64, amount u64 @64, delegate 72..108 (COption), close authority
 * 129..165 (COption). Token-2022 adds an account-type byte at 165 (2 =
 * account, 1 = mint) when the account carries extensions.
 */
const ACCOUNT_SIZE = 165;
const TOKEN_2022_ACCOUNT_TYPE = 2;
/** The pre-read needs the base layout plus Token-2022's account-type byte, never the rest. */
const READ_SLICE = { offset: 0, length: ACCOUNT_SIZE + 1 };
const MAX_KEYS_PER_READ = 100;
/**
 * Rent the taker may spend per account the build creates: a Token-2022
 * account with extensions costs ~0.0021 SOL. The same allowance the wallet
 * applies to 0x swaps.
 */
const ATA_RENT_ALLOWANCE = 2100000n;
const SIGNATURE_FEE = 5000n;
const MICRO_LAMPORTS = 1000000n;

/** Whether `data` (owned by `program`) is a token account, not a mint or a multisig. */
const isTokenAccount = (program, data) => {
  if (program.equals(TOKEN_PROGRAM_ID)) return data.length === ACCOUNT_SIZE;
  if (program.equals(TOKEN_2022_PROGRAM_ID)) {
    return data.length === ACCOUNT_SIZE || data[ACCOUNT_SIZE] === TOKEN_2022_ACCOUNT_TYPE;
  }
  return false;
};

const readTokenFields = (data) => ({
  mint: new PublicKey(data.subarray(0, 32)).toBase58(),
  owner: new PublicKey(data.subarray(32, 64)).toBase58(),
  amount: data.readBigUInt64LE(64),
  authorities: Buffer.concat([data.subarray(72, 108), data.subarray(129, ACCOUNT_SIZE)]),
});

const noAuthorities = Buffer.alloc(36 + 36);

/**
 * The taker's wallet, its token accounts the transaction touches and the
 * associated token accounts it creates for the taker, with their state now.
 *
 * @returns {Promise<{ addresses: string[], before: Map<string, Object|null> }>}
 */
const readTakerAccounts = async (connection, taker, instructions) => {
  const keys = [
    ...new Set([taker, ...instructions.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58()))]),
  ];
  const infos = [];
  for (let start = 0; start < keys.length; start += MAX_KEYS_PER_READ) {
    const chunk = keys.slice(start, start + MAX_KEYS_PER_READ).map((key) => new PublicKey(key));
    infos.push(
      ...(await connection.getMultipleAccountsInfo(chunk, {
        commitment: COMMITMENT,
        dataSlice: READ_SLICE,
      }))
    );
  }
  const before = new Map(keys.map((key, index) => [key, infos[index] ?? null]));
  const owned = keys.filter((key) => {
    const info = before.get(key);
    return (
      key !== taker &&
      info &&
      isTokenAccount(info.owner, info.data) &&
      readTokenFields(info.data).owner === taker
    );
  });
  const created = instructions
    .filter(
      (ix) =>
        ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && ix.keys[2]?.pubkey.toBase58() === taker
    )
    .map((ix) => ix.keys[1].pubkey.toBase58())
    .filter((address) => !before.get(address));
  return { addresses: [...new Set([taker, ...owned, ...created])], before };
};

/** Post-simulation account (RPC shape) → `{ lamports, owner, data }`, or null when absent. */
const fromSimulation = (account) =>
  account
    ? {
        lamports: account.lamports,
        owner: new PublicKey(account.owner),
        data: Buffer.from(account.data[0], 'base64'),
      }
    : null;

/**
 * Why the simulated swap moves the taker's funds beyond the swap, or null
 * when it does not.
 *
 * @param {Object} input
 * @param {{ addresses: string[], before: Map<string, Object|null> }} input.watched
 * @param {Array<Object|null>} input.after - post-simulation accounts, in `addresses` order
 * @param {string} input.taker
 * @param {string} input.inputMint
 * @param {string} input.amount - input amount in base units
 * @param {number} input.accountCreates - associated token account creates in the transaction
 * @param {number} input.signatures
 * @param {number} input.priorityFeeMicroLamports
 * @param {number} input.computeUnitLimit - the limit the simulation ran under
 */
const balanceMismatch = ({
  watched,
  after,
  taker,
  inputMint,
  amount,
  accountCreates,
  signatures,
  priorityFeeMicroLamports,
  computeUnitLimit,
}) => {
  const wrappedSol = NATIVE_MINT.toBase58();
  let lamportsBefore = 0n;
  let lamportsAfter = 0n;
  let inputPaid = 0n;
  for (const [index, address] of watched.addresses.entries()) {
    const pre = watched.before.get(address);
    const post = fromSimulation(after[index]);
    lamportsBefore += BigInt(pre?.lamports ?? 0);
    lamportsAfter += BigInt(post?.lamports ?? 0);
    if (address === taker) continue;

    const preFields = pre ? readTokenFields(pre.data) : null;
    const postFields =
      post && isTokenAccount(post.owner, post.data) ? readTokenFields(post.data) : null;
    if (postFields && postFields.owner !== taker) return `taker account ${address} changes owner`;
    if (postFields && !postFields.authorities.equals(preFields?.authorities ?? noAuthorities)) {
      return `taker account ${address} gains a delegate or close authority`;
    }
    const mint = (preFields ?? postFields)?.mint;
    // Wrapped SOL is counted as lamports above: unwrapping it is not a loss.
    if (!mint || mint === wrappedSol) continue;
    const paid = (preFields?.amount ?? 0n) - (postFields?.amount ?? 0n);
    if (mint === inputMint) inputPaid += paid;
    else if (paid > 0n) return `taker account ${address} loses ${mint}`;
  }
  if (inputMint !== SOL_ADDRESS && inputPaid > BigInt(amount)) {
    return `taker pays ${inputPaid} of ${inputMint}, more than ${amount}`;
  }

  const fees =
    SIGNATURE_FEE * BigInt(signatures) +
    (BigInt(computeUnitLimit) * BigInt(priorityFeeMicroLamports) + MICRO_LAMPORTS - 1n) /
      MICRO_LAMPORTS;
  const allowance =
    (inputMint === SOL_ADDRESS ? BigInt(amount) : 0n) +
    fees +
    ATA_RENT_ALLOWANCE * BigInt(accountCreates);
  const lost = lamportsBefore - lamportsAfter;
  return lost > allowance ? `taker loses ${lost} lamports, more than ${allowance}` : null;
};

module.exports = { readTakerAccounts, balanceMismatch, ATA_RENT_ALLOWANCE };
