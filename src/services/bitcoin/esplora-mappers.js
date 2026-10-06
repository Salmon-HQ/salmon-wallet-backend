'use strict';

/**
 * Esplora → the internal item shapes the Bitcoin resources read
 * (`bitcoin-transaction-resource`, `bitcoin-utxo-resource`,
 * `account-balance-resource`). Those shapes are Blockdaemon Universal's,
 * kept so the public contract did not move when the data source did.
 */

const BTC = { denomination: 'BTC', decimals: 8 };

const NATIVE_CURRENCY = {
  asset_path: 'bitcoin/native/btc',
  symbol: 'BTC',
  name: 'Bitcoin',
  decimals: 8,
  type: 'native',
};

const netOf = (stats) => (stats?.funded_txo_sum ?? 0) - (stats?.spent_txo_sum ?? 0);

/**
 * `GET /address/:address` → one native balance item.
 * `confirmed_balance` counts mined outputs only; `pending_balance` adds the
 * mempool.
 */
const toBalanceItem = (stats, address, blockchain) => {
  const confirmed = netOf(stats.chain_stats);
  return {
    currency: { ...NATIVE_CURRENCY },
    confirmed_balance: String(confirmed),
    pending_balance: String(confirmed + netOf(stats.mempool_stats)),
    owner: address,
    blockchain,
  };
};

/**
 * One Esplora transaction → `{ id, date, status, events }`: a `fee` event,
 * one `utxo_input` per spent output (coinbase inputs spend none) and one
 * `utxo_output` per output.
 */
const toTransaction = (tx, address, blockchain) => ({
  id: tx.txid,
  date: tx.status?.block_time,
  status: 'completed',
  events: [
    { type: 'fee', ...BTC, amount: tx.fee },
    ...tx.vin
      .filter((input) => input.prevout)
      .map((input) => ({
        type: 'utxo_input',
        ...BTC,
        source: input.prevout.scriptpubkey_address,
        amount: input.prevout.value,
      })),
    ...tx.vout.map((output) => ({
      type: 'utxo_output',
      ...BTC,
      destination: output.scriptpubkey_address,
      amount: output.value,
    })),
  ],
  blockchain,
  address,
});

/**
 * The scriptPubKey `address` locks its outputs with, read off any
 * transaction that pays it or spends from it. `undefined` when `txs` does
 * not touch the address.
 */
const findAddressScript = (txs, address) => {
  for (const tx of txs) {
    const output = tx.vout.find((o) => o.scriptpubkey_address === address);
    if (output) return output.scriptpubkey;
    const input = tx.vin.find((i) => i.prevout?.scriptpubkey_address === address);
    if (input) return input.prevout.scriptpubkey;
  }
  return undefined;
};

/** One Esplora UTXO → `{ value, mined: { tx_id, index, meta: { addresses, script } } }`. */
const toUtxo = (utxo, address, script) => ({
  value: utxo.value,
  mined: {
    tx_id: utxo.txid,
    index: utxo.vout,
    meta: { addresses: [address], index: utxo.vout, script },
  },
  address,
});

module.exports = { toBalanceItem, toTransaction, toUtxo, findAddressScript };
