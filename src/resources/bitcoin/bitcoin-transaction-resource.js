'use strict';

const { BITCOIN } = require('../../constants/blockchains');
const { SEND, RECEIVE, SWAP, UNKNOWN } = require('../../constants/transaction-types');
const { getNativeLogo } = require('../../services/shared/trustwallet-service');

const equals = (str1, str2) => str1?.toLowerCase() === str2?.toLowerCase();

/** Classifies the tx as `SWAP` (address is both source and destination), `SEND`, `RECEIVE`, or `UNKNOWN`. */
const getType = (blockchain, address, events) => {
  let transfers = [];
  if (blockchain === BITCOIN) {
    transfers = events.filter(({ type }) => type === 'utxo_input' || type === 'utxo_output');
  }

  const isSource = transfers.filter(({ source }) => equals(source, address)).length === 1;
  const isDestination =
    transfers.filter(({ destination }) => equals(destination, address)).length === 1;

  if (isSource && isDestination) {
    return SWAP;
  } else if (isSource) {
    return SEND;
  } else if (isDestination) {
    return RECEIVE;
  } else {
    return UNKNOWN;
  }
};

/** Returns the `{ amount, decimals, symbol }` fee object, but only when `address` paid it (is the UTXO output source). Returns `undefined` otherwise. */
const getFee = (blockchain, address, events) => {
  const event = events.find(({ type }) => type === 'fee');
  if (!event) {
    return undefined;
  }

  if (blockchain === BITCOIN) {
    const isSource = events.some(
      (event) => event.type === 'utxo_output' && equals(event.destination, address)
    );
    if (!isSource) {
      return undefined;
    }
  }

  const { denomination, amount, decimals } = event;

  return {
    amount,
    decimals,
    symbol: denomination,
  };
};

/** Maps a raw UTXO event into a transfer leg: `{ amount, decimals, symbol, name, logo, contract, source, destination }`. */
const mapTransfer = (blockchain, event) => {
  const { denomination, amount, decimals, source, destination } = event;

  let symbol, logo, name, contract;

  if (blockchain === BITCOIN) {
    if (denomination === 'BTC') {
      symbol = denomination;
      logo = getNativeLogo(blockchain);
      name = 'Bitcoin';
    } else {
      contract = denomination;
    }
  }

  return {
    amount,
    decimals,
    symbol,
    name,
    logo,
    contract,
    source,
    destination,
  };
};

/** Returns the transfer legs where `address` is the destination (funds received). */
const getInputs = (blockchain, address, events) => {
  return events
    .filter(
      ({ type, destination, amount }) => type !== 'fee' && equals(destination, address) && amount
    )
    .map((event) => mapTransfer(blockchain, event));
};

/** Returns the transfer legs where `address` is the source (funds sent). */
const getOutputs = (blockchain, address, events) => {
  return events
    .filter(({ type, source, amount }) => type !== 'fee' && equals(source, address) && amount)
    .map((event) => mapTransfer(blockchain, event));
};

/**
 * Bitcoin transaction resource — public response shape for a single
 * transaction returned from the Bitcoin history/UTXO event feed.
 *
 * @param {Object} transaction - Raw transaction record with `blockchain`,
 *   `address` (the wallet address being viewed), `id`, `date`, `status`,
 *   and `events` (UTXO input/output/fee events).
 * @returns {Promise<Object>} resource
 * @returns {string} resource.id
 * @returns {number} resource.timestamp
 * @returns {string} resource.status
 * @returns {string} resource.type - `SEND` | `RECEIVE` | `SWAP` | `UNKNOWN`
 * @returns {Object|undefined} resource.fee - `{ amount, decimals, symbol }`
 * @returns {Array<Object>} resource.inputs - transfer legs received by `address`
 * @returns {Array<Object>} resource.outputs - transfer legs sent by `address`
 */
module.exports = async (transaction, _include, _key, _context) => {
  // `events = []` rather than undefined: one malformed transaction used to
  // throw inside the bucket helpers and take down the whole page of history.
  const { blockchain, address, id, date, status, events = [] } = transaction;

  const resource = {
    id,
    timestamp: date,
    status,
    type: getType(blockchain, address, events),
    fee: getFee(blockchain, address, events),
    inputs: getInputs(blockchain, address, events),
    outputs: getOutputs(blockchain, address, events),
  };

  return resource;
};
