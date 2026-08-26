'use strict';

/**
 * Solana transaction serialization helpers.
 *
 * Use `createTransactionResponseFromWeb3` when the source is a web3.js
 * `Transaction` or `VersionedTransaction` (legacy txs are coerced to v0
 * messages on the fly). Use `createTransactionResponseFromUmiBuilder` when
 * the source is a Metaplex Umi builder — it builds with the latest
 * blockhash, converts to web3.js, then funnels through the same v0 path.
 *
 * Output shape: `{ transaction: <base64-encoded VersionedTransaction> }`.
 */

const { Transaction, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
const { toWeb3JsTransaction } = require('@metaplex-foundation/umi-web3js-adapters');

/**
 * Coerce a web3.js transaction to a v0 `VersionedTransaction`. Already-
 * versioned transactions pass through unchanged; legacy `Transaction`s are
 * rebuilt via `TransactionMessage.compileToV0Message()`.
 * @throws {Error} `'Unsupported transaction type for serialization.'` for
 *   any other input.
 */
const toVersionedTransaction = (transaction) => {
  if (transaction instanceof VersionedTransaction) {
    return transaction;
  }

  if (transaction instanceof Transaction) {
    const message = new TransactionMessage({
      payerKey: transaction.feePayer,
      recentBlockhash: transaction.recentBlockhash,
      instructions: transaction.instructions,
    }).compileToV0Message();

    return new VersionedTransaction(message);
  }

  throw new Error('Unsupported transaction type for serialization.');
};

const serializeVersionedTransaction = (transaction) => ({
  transaction: Buffer.from(transaction.serialize()).toString('base64'),
});

/**
 * Serialize a web3.js transaction (legacy or versioned) to the wire shape.
 * Legacy `Transaction` is coerced to a v0 `VersionedTransaction` first.
 * @param {Transaction|VersionedTransaction} transaction
 * @returns {{transaction: string}} base64-encoded versioned tx.
 */
const createTransactionResponseFromWeb3 = (transaction) => {
  return serializeVersionedTransaction(toVersionedTransaction(transaction));
};

/**
 * Build a Umi transaction with the latest blockhash, convert to web3.js, and
 * serialize as a versioned tx.
 * @param {object} umi - Umi instance.
 * @param {object} builder - Umi transaction builder.
 * @returns {Promise<{transaction: string}>} base64-encoded versioned tx.
 */
const createTransactionResponseFromUmiBuilder = async (umi, builder) => {
  const builtTransaction = await builder.buildWithLatestBlockhash(umi);
  const web3Transaction = toWeb3JsTransaction(builtTransaction);
  return createTransactionResponseFromWeb3(web3Transaction);
};

module.exports = {
  createTransactionResponseFromWeb3,
  createTransactionResponseFromUmiBuilder,
};
