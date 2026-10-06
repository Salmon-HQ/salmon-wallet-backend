'use strict';

/**
 * Bitcoin UTXO service.
 *
 * Esplora returns an address's whole unspent set in one answer
 * (`GET /address/:a/utxo`), mempool outputs included; only mined ones are
 * returned, as the API always has. The set
 * carries no scriptPubKey, so it is read once off the address's history —
 * every output of one address shares it.
 *
 * Deliberately uncached: the wallet re-reads the UTXO set right after a
 * broadcast to build the next spend, and a stale set would hand it
 * already-spent outputs.
 */

const esplora = require('../../infrastructure/esplora-client');
const { toUtxo, findAddressScript } = require('./esplora-mappers');

/**
 * Esplora hosts refuse to enumerate very large unspent sets with a 400
 * (mempool.space past 500 outputs, blockstream past its scan limit), told
 * apart from other 400s by their wording. That is not the caller's input
 * being wrong, so it is answered as the API
 * always has for this case.
 */
const TOO_LARGE = /too many unspent|too large/i;

const asTooLarge = (error) => {
  if (error?.response?.status !== 400) return error;
  if (!TOO_LARGE.test(error.response.data?.message ?? '')) return error;
  const tooLarge = new Error(
    'This address has too many unspent outputs to enumerate in one request.'
  );
  tooLarge.statusCode = 422;
  tooLarge.errorCode = 'utxo_set_too_large';
  return tooLarge;
};

/**
 * @param {string} address
 * @param {Object} _filters - unused; the whole set is always returned.
 * @param {{network: {environment: string}}} locals
 * @returns {Promise<{data: Array<Object>, meta: {nextPageToken: null}}>}
 */
const getUtxo = async (address, _filters, locals) => {
  let utxos;
  try {
    utxos = await esplora.get(`/address/${address}/utxo`, locals);
  } catch (error) {
    throw asTooLarge(error);
  }

  utxos = utxos.filter((utxo) => utxo.status?.confirmed);

  const script = utxos.length
    ? findAddressScript(await esplora.get(`/address/${address}/txs`, locals), address)
    : undefined;

  return {
    data: utxos.map((utxo) => toUtxo(utxo, address, script)),
    meta: { nextPageToken: null },
  };
};

module.exports = {
  getUtxo,
};
