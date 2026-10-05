'use strict';

/**
 * Bitcoin balance provider (`BalanceProvider`): the address's native balance
 * from Esplora (`GET /address/:address`), as one item in the shape
 * `account-balance-resource` reads.
 */

const esplora = require('../../infrastructure/esplora-client');
const { toBalanceItem } = require('./esplora-mappers');

const getBalance = async (address, _tokens, locals) => {
  const stats = await esplora.get(`/address/${address}`, locals);
  return [toBalanceItem(stats, address, locals.network.blockchain)];
};

module.exports = { getBalance };
