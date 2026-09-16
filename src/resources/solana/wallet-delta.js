'use strict';

/**
 * What one wallet gained or lost in a transaction, per asset (spec 016).
 *
 * The provider's transfer lists say who moved what to whom, one row per
 * instruction; they cannot say what the wallet ended up with — rent
 * returned by a closed account is no transfer, a token that hopped between
 * two accounts of the same owner is two, a fee paid five times is five.
 * The ledger's balance changes can: `accountData` carries post-minus-pre
 * lamports per account and raw token deltas per token account with its
 * owner, from Helius and from the local parser alike.
 *
 * Pure. Amounts are strings of raw units, signed; BigInt inside so a large
 * token balance never rounds.
 */

const { SOL_DECIMALS } = require('../../constants/solana-constants');

/**
 * @typedef {object} WalletDelta
 * @property {string} native  Signed lamports, the fee excluded when the wallet paid it.
 * @property {Map<string, {amount: string, decimals: number}>} tokens  Signed raw amount per mint.
 * @property {'accountData'|'transfers'} source  Where the numbers came from.
 */

const toBigInt = (value) => {
  if (typeof value === 'bigint') return value;
  if (value === undefined || value === null || value === '') return 0n;
  if (typeof value === 'number') return BigInt(Math.round(value));
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

const addToken = (tokens, mint, amount, decimals) => {
  if (!mint) return;
  const current = tokens.get(mint) || { amount: 0n, decimals };
  tokens.set(mint, {
    amount: current.amount + amount,
    decimals: current.decimals ?? decimals,
  });
};

/** From the ledger: the wallet's own row for lamports, every token row it owns. */
const fromAccountData = (accountData, address) => {
  let native = 0n;
  const tokens = new Map();
  accountData.forEach((row) => {
    if (row.account === address) native += toBigInt(row.nativeBalanceChange);
    (row.tokenBalanceChanges || []).forEach((change) => {
      if (change.userAccount !== address) return;
      const raw = change.rawTokenAmount || {};
      addToken(
        tokens,
        change.mint,
        toBigInt(raw.tokenAmount),
        raw.decimals ?? change.decimals ?? 0
      );
    });
  });
  return { native, tokens };
};

/**
 * Without the ledger (a payload from before `accountData` was carried, a
 * provider that drops it): incoming minus outgoing per asset from the
 * transfers. Degraded on purpose — a closed account's rent is invisible
 * here — and marked so a test can tell.
 */
const fromTransfers = (transaction, address, toRawAmount) => {
  let native = 0n;
  const tokens = new Map();
  (transaction.nativeTransfers || []).forEach((transfer) => {
    const amount = toBigInt(transfer.amount);
    if (transfer.toUserAccount === address) native += amount;
    if (transfer.fromUserAccount === address) native -= amount;
  });
  (transaction.tokenTransfers || []).forEach((transfer) => {
    const decimals = transfer.decimals ?? 0;
    const amount = toBigInt(toRawAmount(transfer.tokenAmount, decimals));
    if (transfer.toUserAccount === address) addToken(tokens, transfer.mint, amount, decimals);
    if (transfer.fromUserAccount === address) addToken(tokens, transfer.mint, -amount, decimals);
  });
  return { native, tokens };
};

/**
 * @param {object} transaction  Enriched transaction (Helius or parser shape).
 * @param {string} address      The wallet under inspection.
 * @param {{toRawAmount: (tokenAmount: number|string, decimals: number) => string}} deps
 *   The resource's amount normaliser, so the fallback reads provider amounts
 *   the same way the legs do.
 * @returns {WalletDelta}
 */
const computeWalletDelta = (transaction, address, { toRawAmount }) => {
  const hasLedger = Array.isArray(transaction.accountData) && transaction.accountData.length > 0;
  const { native, tokens } = hasLedger
    ? fromAccountData(transaction.accountData, address)
    : fromTransfers(transaction, address, toRawAmount);

  // The fee has its own field on the payload; the legs say what moved
  // besides it. The ledger's row for the fee payer already subtracted it.
  const feePaid = hasLedger && transaction.feePayer === address ? toBigInt(transaction.fee) : 0n;

  const cleaned = new Map();
  tokens.forEach((entry, mint) => {
    if (entry.amount !== 0n)
      cleaned.set(mint, { amount: entry.amount.toString(), decimals: entry.decimals });
  });

  return {
    native: (native + feePaid).toString(),
    tokens: cleaned,
    source: hasLedger ? 'accountData' : 'transfers',
  };
};

module.exports = { computeWalletDelta, SOL_DECIMALS };
