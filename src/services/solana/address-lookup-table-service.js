'use strict';

/**
 * Address lookup table fallback service.
 *
 * Builds the create + extend transactions needed to produce a temporary
 * Solana address lookup table for an oversized versioned transaction. Used
 * by `burn-service.js` to fit a compressed-NFT burn into a single tx by
 * compressing static account keys behind a lookup table.
 */

const {
  AddressLookupTableProgram,
  Connection,
  PublicKey,
  Transaction,
} = require('@solana/web3.js');
const { fromWeb3JsPublicKey } = require('@metaplex-foundation/umi-web3js-adapters');
const { createTransactionResponseFromWeb3 } = require('./transaction-serialization');

const LOOKUP_TABLE_EXTEND_CHUNK_SIZE = 20;
const LOOKUP_TABLE_META_SIZE = 56;

/** De-dupe an array of `PublicKey`s by base58 string, preserving order. */
const uniquePublicKeys = (publicKeys) => {
  const seen = new Set();

  return publicKeys.filter((publicKey) => {
    const key = publicKey.toBase58();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * Collect the unique non-signer static account keys from a versioned
 * transaction's message — these are the addresses eligible to be moved
 * into a lookup table (signer keys must stay inline).
 */
const collectLookupTableCandidateAddresses = (versionedTransaction) => {
  const signerCount = versionedTransaction.message.header.numRequiredSignatures;
  return uniquePublicKeys(versionedTransaction.message.staticAccountKeys.slice(signerCount));
};

/** Split `items` into consecutive chunks of at most `chunkSize` entries. */
const splitIntoChunks = (items, chunkSize) => {
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
};

/**
 * Assemble a legacy `Transaction` from `instructions`, stamp it with the
 * latest blockhash, and serialize it via `createTransactionResponseFromWeb3`
 * (which coerces it to a v0 versioned tx on the way out).
 */
const createVersionedResponseFromInstructions = async (connection, feePayer, instructions) => {
  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = feePayer;
  transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  return createTransactionResponseFromWeb3(transaction);
};

/**
 * Build a multi-step lookup-table fallback for an oversized versioned tx.
 *
 * Collects unique non-signer static account keys from the source tx, emits
 * a `createLookupTable` instruction plus chunked `extendLookupTable`
 * instructions (`LOOKUP_TABLE_EXTEND_CHUNK_SIZE` addresses per chunk), and
 * returns serialized create/extend transactions plus rent estimates and a
 * `lookupTableInput` ready to feed back into a Umi builder.
 *
 * Returns null if the source transaction has no candidate addresses to
 * compress (i.e. the lookup-table flow is unnecessary).
 *
 * @param {Object} params
 * @param {string} params.owner - Owner / fee payer base58 address.
 * @param {string} params.nodeUrl - Solana RPC URL.
 * @param {VersionedTransaction} params.versionedTransaction - The oversized
 *   transaction whose static account keys should be compressed.
 * @returns {Promise<Object|null>} Object with `lookupTableAddress`,
 *   `lookupTableInput`, `lookupTable` (rent + counts), and `transactions`
 *   (create + extend steps with `step` and `expectedLookupTableAddressCount`
 *   fields), or null if no compression is needed.
 */
const createLookupTableFallbackTransactions = async ({ owner, nodeUrl, versionedTransaction }) => {
  const connection = new Connection(nodeUrl, 'confirmed');
  const ownerPublicKey = new PublicKey(owner);
  const lookupTableAddresses = collectLookupTableCandidateAddresses(versionedTransaction);

  if (lookupTableAddresses.length === 0) {
    return null;
  }

  const currentSlot = await connection.getSlot('confirmed');
  const [createInstruction, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: ownerPublicKey,
    payer: ownerPublicKey,
    recentSlot: currentSlot - 1,
  });

  const createTransaction = await createVersionedResponseFromInstructions(
    connection,
    ownerPublicKey,
    [createInstruction]
  );

  const extendTransactions = [];
  const addressChunks = splitIntoChunks(lookupTableAddresses, LOOKUP_TABLE_EXTEND_CHUNK_SIZE);
  const lookupTableSize = LOOKUP_TABLE_META_SIZE + 32 * lookupTableAddresses.length;
  const estimatedRentLamports = await connection.getMinimumBalanceForRentExemption(lookupTableSize);

  for (const addresses of addressChunks) {
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
      payer: ownerPublicKey,
      authority: ownerPublicKey,
      lookupTable: lookupTableAddress,
      addresses,
    });

    extendTransactions.push(
      await createVersionedResponseFromInstructions(connection, ownerPublicKey, [extendInstruction])
    );
  }

  return {
    lookupTableAddress,
    lookupTableInput: {
      publicKey: fromWeb3JsPublicKey(lookupTableAddress),
      addresses: lookupTableAddresses.map(fromWeb3JsPublicKey),
    },
    lookupTable: {
      required: true,
      estimatedRentLamports,
      estimatedRentSol: estimatedRentLamports / 1e9,
      addressCount: lookupTableAddresses.length,
      extendTransactionCount: extendTransactions.length,
    },
    transactions: [
      {
        ...createTransaction,
        step: 'lookup_table_create',
        lookupTableAddress: lookupTableAddress.toBase58(),
        expectedLookupTableAddressCount: 0,
      },
      ...extendTransactions.map((transaction, index) => ({
        ...transaction,
        step: 'lookup_table_extend',
        lookupTableAddress: lookupTableAddress.toBase58(),
        expectedLookupTableAddressCount: addressChunks
          .slice(0, index + 1)
          .reduce((total, chunk) => total + chunk.length, 0),
        message: `Extend lookup table batch ${index + 1}/${extendTransactions.length}`,
      })),
    ],
  };
};

module.exports = {
  createLookupTableFallbackTransactions,
};
