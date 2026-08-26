'use strict';

/**
 * Bitcoin UTXO resource — public response shape for a single unspent
 * transaction output.
 *
 * The wallet feeds this straight into its PSBT builder, which reads `txid`
 * and `vout`. Those names are emitted alongside the original `txId` /
 * `outputIndex` rather than instead of them: the old names are the shipped
 * contract, and an additive alias costs nothing while a rename breaks any
 * client still reading them.
 *
 * Incomplete records are dropped rather than passed through with undefined
 * fields. This feeds transaction construction, so a UTXO missing its
 * transaction id or index cannot be spent anyway, and letting it through
 * only moves the failure to a place with less context.
 *
 * Still missing for the wallet's current address type: `rawTx`. See the
 * `bitcoin-account-history` notes in AGENTS.md.
 *
 * @param {Object} utxo - Raw UTXO record with `mined` (block-inclusion
 *   metadata) and `value` (satoshis).
 * @returns {Promise<Object|null>} resource, or null when the record cannot
 *   describe a spendable output.
 * @returns {string|undefined} resource.address
 * @returns {string|undefined} resource.txId - legacy name, kept for shipped clients
 * @returns {string|undefined} resource.txid - name the wallet's PSBT builder reads
 * @returns {number|undefined} resource.outputIndex - legacy name
 * @returns {number|undefined} resource.vout - name the wallet's PSBT builder reads
 * @returns {string|undefined} resource.script
 * @returns {number} resource.satoshis
 */
module.exports = async (utxo, _include, _key, _context) => {
  const { mined, value } = utxo;

  const txId = mined?.tx_id;
  const outputIndex = mined?.index;

  if (!txId || typeof outputIndex !== 'number') {
    return null;
  }

  return {
    address: mined?.meta?.addresses?.[0],
    txId,
    txid: txId,
    outputIndex,
    vout: outputIndex,
    script: mined?.meta?.script,
    satoshis: value,
  };
};
