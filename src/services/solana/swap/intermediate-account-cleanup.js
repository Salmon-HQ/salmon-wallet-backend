'use strict';

/**
 * Closes the token accounts a multi-hop swap creates only to pass through.
 *
 * 0x inserts `createIdempotent` for every associated token account (ATA) a
 * route needs, including the taker's ATA for an intermediate token
 * (USDC → USD1 → SOL creates a USD1 account). The account ends the swap
 * empty and stays open, and its rent deposit (~0.002 SOL, 17% of a 1 USDC
 * swap) reads to the user as a loss. Jupiter avoids it with program-owned
 * shared accounts; 0x does not, so we append a `CloseAccount` per
 * intermediate ATA the build itself creates: the taker owns the account and
 * signs the whole transaction, so the deposit comes back in the same block.
 *
 * Only accounts that do not exist yet AND are not the input/output token are
 * closed — a pre-existing account is the user's, the output account is where
 * the bought token lives. `CloseAccount` fails on a non-zero balance, which
 * would fail the swap; the build service simulates with the cleanup and
 * drops it when the simulation rejects it.
 */

const { PublicKey } = require('@solana/web3.js');
const { ASSOCIATED_TOKEN_PROGRAM_ID, createCloseAccountInstruction } = require('@solana/spl-token');
const { SOL_ADDRESS } = require('../../../constants/solana-constants');

const COMMITMENT = 'confirmed';
/** ATA `Create` / `CreateIdempotent` key order: payer, ata, owner, mint, system, token program. */
const ATA_KEYS = { ata: 1, owner: 2, mint: 3, tokenProgram: 5 };

const createdAccounts = (instructions) =>
  instructions
    .filter((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && ix.keys.length >= 6)
    .map((ix) => ({
      ata: ix.keys[ATA_KEYS.ata].pubkey,
      owner: ix.keys[ATA_KEYS.owner].pubkey.toBase58(),
      mint: ix.keys[ATA_KEYS.mint].pubkey.toBase58(),
      tokenProgram: ix.keys[ATA_KEYS.tokenProgram].pubkey,
    }));

/**
 * `CloseAccount` instructions for the intermediate ATAs `instructions` create
 * for `taker`, rent refunded to the taker. Empty when the route has none.
 *
 * @param {import('@solana/web3.js').Connection} connection
 * @param {import('@solana/web3.js').TransactionInstruction[]} instructions - provider instructions
 * @param {{ taker: string, inputMint: string, outputMint: string }} swap
 * @returns {Promise<import('@solana/web3.js').TransactionInstruction[]>}
 */
const intermediateAccountCleanup = async (
  connection,
  instructions,
  { taker, inputMint, outputMint }
) => {
  const keep = new Set([inputMint, outputMint, SOL_ADDRESS]);
  const candidates = createdAccounts(instructions).filter(
    (account) => account.owner === taker && !keep.has(account.mint)
  );
  if (candidates.length === 0) {
    return [];
  }
  const infos = await connection.getMultipleAccountsInfo(
    candidates.map((account) => account.ata),
    COMMITMENT
  );
  const takerKey = new PublicKey(taker);
  return candidates
    .filter((_, index) => !infos[index])
    .map((account) =>
      createCloseAccountInstruction(account.ata, takerKey, takerKey, [], account.tokenProgram)
    );
};

module.exports = { intermediateAccountCleanup };
