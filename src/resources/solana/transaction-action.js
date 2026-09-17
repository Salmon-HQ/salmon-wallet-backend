'use strict';

/**
 * What an interaction actually was (spec 017). Solana has no canonical tags:
 * every wallet derives them from the programs a transaction touched and from
 * what moved. `type` keeps the nine buckets the filters and icons read; this
 * names the verb inside `interaction`, as a stable key the client translates,
 * never prose.
 *
 * Read from the legs (already the wallet's net change per asset) and the
 * provider's `source` — the parser and Helius both name the program family
 * (`AGGREGATOR`, `RAYDIUM`, `MAGIC_EDEN`, …) — plus the ledger rows for the
 * one shape neither transfer nor program names: token accounts closed for
 * their rent.
 */

const { INTERACTION } = require('../../constants/transaction-types');
const { SOL_ADDRESS } = require('../../constants/solana-constants');

/**
 * The name a user knows the program family by, for the detail. Absent for
 * the platform's own programs (nothing to name) and for what we cannot name.
 */
const APP_NAMES = {
  AGGREGATOR: 'Jupiter',
  AGGREGATOR_LIMIT: 'Jupiter',
  JUPITER: 'Jupiter',
  RAYDIUM: 'Raydium',
  ORCA: 'Orca',
  METEORA: 'Meteora',
  METEORA_DBC: 'Meteora',
  PUMP_FUN: 'pump.fun',
  PUMP_AMM: 'pump.fun',
  MAGIC_EDEN: 'Magic Eden',
  TENSOR: 'Tensor',
  MARINADE_FINANCE: 'Marinade',
  STAKE_POOL: 'Stake pool',
  SANCTUM: 'Sanctum',
  SANCTUM_INFINITY: 'Sanctum',
  JITO_TIP: 'Jito',
  SOLEND: 'Solend',
  KAMINO: 'Kamino',
  MARGINFI: 'marginfi',
  PHOENIX: 'Phoenix',
  OPENBOOK_V2: 'OpenBook',
  LIFINITY: 'Lifinity',
  SABER: 'Saber',
  WORMHOLE: 'Wormhole',
  SNS: 'Solana Name Service',
  DRIFT_V2: 'Drift',
  MOONSHOT: 'Moonshot',
  HELIUM_DAO: 'Helium',
  SQUADS_V4: 'Squads',
  MAYAN_FINANCE: 'Mayan',
  DEBRIDGE: 'deBridge',
  LAUNCHLAB: 'LaunchLab',
  PHOTON: 'Photon',
  METAPLEX: 'Metaplex',
  METAPLEX_TOKEN_METADATA: 'Metaplex',
  BUBBLEGUM: 'Metaplex',
};

const appNameFor = (source) => APP_NAMES[source];

/**
 * Token accounts closed for their rent: ledger rows other than the wallet's
 * whose lamports went to zero — the closed account's whole balance is the
 * rent, and it went to the owner. Counted only when SOL came back and
 * nothing else moved, so a program that drains a hop account mid-swap does
 * not read as a cleanup.
 */
const countClosedAccounts = (transaction, address) => {
  // A vault that was paid in the same transaction also ends lower or
  // higher; a closed account is never paid.
  const paid = new Set((transaction.nativeTransfers || []).map((t) => t.toUserAccount));
  return (transaction.accountData || []).filter(
    (row) =>
      row.account !== address &&
      row.nativeBalanceChange < 0 &&
      (row.tokenBalanceChanges || []).length === 0 &&
      !paid.has(row.account)
  ).length;
};

const hasNftLeg = (legs) => legs.some((leg) => leg.isNft);
const isSolLeg = (leg) => leg.contract === SOL_ADDRESS;

/**
 * @param {object} transaction  Enriched transaction (Helius or parser shape).
 * @param {string} address      The wallet under inspection.
 * @param {{inputs: object[], outputs: object[]}} legs  Net legs, NFT-marked.
 * @param {string} type         The resolved bucket.
 * @param {string|undefined} source  The public source name.
 * @returns {{action?: string, actionMeta?: object, app?: string}}
 */
const deriveAction = (transaction, address, legs, type, source) => {
  const app = appNameFor(source);
  const result = app ? { app } : {};
  if (type !== INTERACTION) return result;

  const { inputs, outputs } = legs;
  const twoSided = inputs.length > 0 && outputs.length > 0;

  if (twoSided && (hasNftLeg(inputs) || hasNftLeg(outputs))) {
    const soldNft = hasNftLeg(outputs);
    return {
      ...result,
      action: soldNft ? 'nft_sale' : 'nft_purchase',
    };
  }

  if (twoSided) {
    // Two assets traded on a program that trades: a swap. Two assets on any
    // other program is still an exchange the user made, so the verb holds.
    return { ...result, action: 'swap' };
  }

  const onlySolBack = inputs.length === 1 && outputs.length === 0 && isSolLeg(inputs[0]);
  if (onlySolBack) {
    const count = countClosedAccounts(transaction, address);
    if (count > 0) return { ...result, action: 'accounts_closed', actionMeta: { count } };
  }

  return { ...result, action: 'program_call' };
};

module.exports = { deriveAction, APP_NAMES };
