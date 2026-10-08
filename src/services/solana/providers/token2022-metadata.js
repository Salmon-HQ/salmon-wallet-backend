'use strict';

/**
 * On-chain metadata of Token-2022 NFTs.
 *
 * A Token-2022 mint can carry its name, symbol and URI itself (`tokenMetadata`)
 * or point at another account that does (`metadataPointer`). The indexer
 * reports neither for some mints — the Seeker Genesis Token arrives with empty
 * content — so the listing reads them here.
 *
 * A pointer is followed only to the mint's own token group. Whoever creates a
 * mint chooses its pointer, so a blind follow would let any mint wear a known
 * collection's name and image; joining a group, by contrast, needs the group's
 * update authority to sign, so a pointer to the mint's own group is the
 * issuer's.
 */

const { PublicKey } = require('@solana/web3.js');

// getMultipleAccounts takes at most 100 keys per call.
const BATCH = 100;

const extensionsOf = (account) => account?.data?.parsed?.info?.extensions ?? [];
const extension = (account, name) =>
  extensionsOf(account).find((e) => e.extension === name)?.state ?? null;

const toMetadata = (state) =>
  state?.name ? { name: state.name, symbol: state.symbol || '', uri: state.uri || '' } : null;

/** The pointer target worth reading for `mintAccount`, or null. */
const groupPointer = (mintAddress, mintAccount) => {
  const target = extension(mintAccount, 'metadataPointer')?.metadataAddress;
  if (!target || target === mintAddress) return null;
  return extension(mintAccount, 'tokenGroupMember')?.group === target ? target : null;
};

/**
 * @param {string} mintAddress
 * @param {Object|null} mintAccount - jsonParsed mint account.
 * @param {Map<string, Object>} accounts - jsonParsed pointer targets by address.
 * @returns {{name: string, symbol: string, uri: string}|null}
 */
const pickMetadata = (mintAddress, mintAccount, accounts) => {
  const own = toMetadata(extension(mintAccount, 'tokenMetadata'));
  if (own) return own;
  const target = groupPointer(mintAddress, mintAccount);
  return target ? toMetadata(extension(accounts.get(target), 'tokenMetadata')) : null;
};

const readAccounts = async (connection, addresses) => {
  const byAddress = new Map();
  for (let i = 0; i < addresses.length; i += BATCH) {
    const chunk = addresses.slice(i, i + BATCH);
    const { value } = await connection.getMultipleParsedAccounts(
      chunk.map((a) => new PublicKey(a))
    );
    chunk.forEach((address, j) => byAddress.set(address, value[j] ?? null));
  }
  return byAddress;
};

/**
 * Name, symbol and URI for each mint that has them on chain. Fails open: an
 * RPC failure answers an empty map, and the NFTs stay as the indexer gave them.
 *
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string[]} mints
 * @returns {Promise<Map<string, {name: string, symbol: string, uri: string}>>}
 */
const resolveToken2022Metadata = async (connection, mints) => {
  const result = new Map();
  if (mints.length === 0) return result;
  try {
    const mintAccounts = await readAccounts(connection, mints);
    const targets = [
      ...new Set(mints.map((m) => groupPointer(m, mintAccounts.get(m))).filter(Boolean)),
    ];
    const targetAccounts = targets.length ? await readAccounts(connection, targets) : new Map();
    for (const mint of mints) {
      const metadata = pickMetadata(mint, mintAccounts.get(mint), targetAccounts);
      if (metadata) result.set(mint, metadata);
    }
  } catch (error) {
    console.warn(`[TOKEN2022_METADATA] could not read mint metadata: ${error.message}`);
    return new Map();
  }
  return result;
};

module.exports = { pickMetadata, resolveToken2022Metadata };
