'use strict';

/**
 * Bitcoin transaction service.
 *
 * History reads from Esplora. First-page history requests are cached;
 * paginated requests always hit upstream.
 *
 * Esplora pages confirmed history 25 transactions at a time (mempool.space
 * answers the first call with up to 50), keyed by the
 * last txid seen (`/address/:a/txs/chain/:txid`); the first call
 * (`/address/:a/txs`) also returns the address's mempool transactions,
 * which are dropped: history lists mined transactions only, as it always
 * has. A page is filled to `pageSize` and its `nextPageToken` is the txid of
 * the last one — absent once Esplora has no more.
 */

const esplora = require('../../infrastructure/esplora-client');
const { clampPageSize } = require('./page-size');
const { toTransaction } = require('./esplora-mappers');
const {
  buildCacheKey,
  isFirstPageQuery,
  withCachedTransactionHistory,
} = require('../../infrastructure/cache/transaction-history-cache');

const ESPLORA_CHAIN_PAGE = 25;

const isConfirmed = (tx) => Boolean(tx.status?.confirmed);

/**
 * @param {string} address
 * @param {{pageToken?: string, pageSize?: number}} filters - `pageToken` is
 *   the txid the previous page ended on.
 * @param {{network: {blockchain: string, environment: string}}} locals
 * @returns {Promise<{data: Array<Object>, meta: {nextPageToken?: string}}>}
 */
const fetchTransactions = async (address, filters, locals) => {
  const pageSize = clampPageSize(filters.pageSize);
  const confirmed = [];
  let chunk;
  let cursor = filters.pageToken;

  do {
    chunk = await esplora.get(
      cursor ? `/address/${address}/txs/chain/${cursor}` : `/address/${address}/txs`,
      locals
    );
    const mined = chunk.filter(isConfirmed);
    confirmed.push(...mined);
    chunk = mined;
    cursor = mined.at(-1)?.txid;
    // A chunk shorter than a chain page is the end of the history; a longer
    // one is mempool.space's 50-transaction first answer, not the end.
  } while (chunk.length >= ESPLORA_CHAIN_PAGE && confirmed.length < pageSize);

  const page = confirmed.slice(0, pageSize);
  const more = confirmed.length > pageSize || chunk.length >= ESPLORA_CHAIN_PAGE;

  return {
    data: page.map((tx) => toTransaction(tx, address, locals.network.blockchain)),
    meta: { nextPageToken: more ? page.at(-1)?.txid : undefined },
  };
};

/**
 * Fetches an account's transaction history, transparently caching
 * first-page requests (see `withCachedTransactionHistory`). Paginated
 * requests always hit upstream.
 *
 * @param {string} address
 * @param {{pageToken?: string, pageSize?: number}} filters - see `fetchTransactions`.
 * @param {{network: {blockchain: string, environment: string, id?: string}}} locals
 * @returns {Promise<{data: Array<Object>, meta: {nextPageToken?: string}}>}
 */
const getTransactions = async (address, filters, locals) => {
  const loadTransactions = () => fetchTransactions(address, filters, locals);

  if (!isFirstPageQuery(filters)) {
    return loadTransactions();
  }

  return withCachedTransactionHistory(
    buildCacheKey('bitcoin-transactions', address, filters, locals),
    loadTransactions
  );
};

module.exports = {
  getTransactions,
};
