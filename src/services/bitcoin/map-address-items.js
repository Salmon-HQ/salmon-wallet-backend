'use strict';

/**
 * Decorates each upstream Blockdaemon item (transaction, UTXO) with the
 * requesting `address` and (when provided) `blockchain`.
 *
 * @param {Array<Object>} items - raw items from Blockdaemon.
 * @param {string} address - requested account address.
 * @param {string} [blockchain] - value of `locals.network.blockchain`;
 *   omitted from output when falsy.
 * @returns {Array<Object>} items with `address` (+ optional `blockchain`) added.
 */
const mapAddressItems = (items, address, blockchain) =>
  items.map((item) => ({
    ...item,
    ...(blockchain ? { blockchain } : {}),
    address,
  }));

module.exports = { mapAddressItems };
