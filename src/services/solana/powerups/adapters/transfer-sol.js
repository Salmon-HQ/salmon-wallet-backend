'use strict';

/**
 * `transfer-sol` — the reference Powerup that moves an amount.
 *
 * One System-program transfer of native SOL to a recipient the caller names.
 * `memo` proves the build path; this one proves the parts of the interface
 * that only appear when a number is involved: the amount card, its USD
 * conversion and the confirmation's typed rows. Enabled on the `local` stage
 * only (see `network-capabilities-local.js`).
 *
 * The USD value is data for the screen, not a quote: it comes from the same
 * price source as the balance, and is null when the price is unavailable —
 * never zero, which would read as "worthless".
 */

const { PublicKey, SystemProgram } = require('@solana/web3.js');
const { SOL_ADDRESS, SOL_DECIMALS, SOL_SYMBOL } = require('../../../../constants/solana-constants');
const { isValidSolanaAddress } = require('../../../../utils/solana-address');
const coingecko = require('../../../shared/coingecko-service');

const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();
const LAMPORTS_PER_SOL = 1000000000;
/** Below this the transfer is dust the network fee dwarfs; refuse it as caller input. */
const MIN_LAMPORTS = 1000;

/** `{ params }` or a 400 envelope (`amount_too_small` is declared on the registry entry). */
const validate = (query) => {
  const { recipient, uiAmount, publicKey } = query;
  if (!recipient) {
    return {
      error: 'missing_parameter',
      error_description: 'Missing required query params: recipient',
    };
  }
  if (!isValidSolanaAddress(recipient)) {
    return {
      error: 'invalid_parameter',
      error_description: 'recipient is not a valid Solana address',
    };
  }
  if (recipient === publicKey) {
    return {
      error: 'invalid_parameter',
      error_description: 'recipient must differ from the sender',
    };
  }
  if (uiAmount === undefined || uiAmount === '') {
    return {
      error: 'missing_parameter',
      error_description: 'Missing required query params: uiAmount',
    };
  }
  const numeric = Number(uiAmount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { error: 'invalid_parameter', error_description: 'uiAmount must be a positive number' };
  }
  const lamports = Math.round(numeric * LAMPORTS_PER_SOL);
  if (lamports < MIN_LAMPORTS) {
    return {
      error: 'amount_too_small',
      error_description: `uiAmount must be at least ${MIN_LAMPORTS / LAMPORTS_PER_SOL} SOL`,
    };
  }
  return { params: { recipient, lamports, publicKey } };
};

/** The transfer instruction plus the typed rows the confirmation renders. */
const build = async ({ recipient, lamports, publicKey }, { locals }) => {
  const usdPrice = await coingecko
    .getTokenPrices([SOL_ADDRESS], locals)
    .then((prices) => prices.get(SOL_ADDRESS)?.usdPrice ?? null)
    .catch((error) => {
      console.warn(`[BUILD] SOL price unavailable (${error.message}); rendering without USD`);
      return null;
    });

  return {
    instructions: [
      SystemProgram.transfer({
        fromPubkey: new PublicKey(publicKey),
        toPubkey: new PublicKey(recipient),
        lamports,
      }),
    ],
    provider: { id: 'solana', displayName: 'Solana', attribution: null },
    display: {
      recipient,
      amount: String(lamports),
      mint: SOL_ADDRESS,
      decimals: SOL_DECIMALS,
      symbol: SOL_SYMBOL,
      usdValue:
        usdPrice === null ? null : Number(((lamports / LAMPORTS_PER_SOL) * usdPrice).toFixed(2)),
    },
  };
};

module.exports = { validate, build, SYSTEM_PROGRAM_ID, MIN_LAMPORTS };
