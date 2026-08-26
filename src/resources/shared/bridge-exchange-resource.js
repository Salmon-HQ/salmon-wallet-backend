'use strict';

/**
 * Bridge exchange resource — public response shape for a StealthEX
 * exchange, served by both `GET /v1/bridge/exchange` (creation) and
 * `GET /v1/bridge/transaction` (status polling).
 *
 * Maps the upstream payload to the camelCase contract the wallet consumes,
 * coerces amounts to numbers, and normalizes `status`.
 *
 * v4 splits what v2 kept flat into `deposit` and `withdrawal` sub-objects with
 * identical shapes, which makes a copy-paste slip here both type-correct and
 * expensive: `payinAddress` is the address the user's funds are sent to, so
 * sourcing it from `withdrawal` would send every user's deposit to their own
 * payout address. It comes from `deposit.address`, and the tests assert the
 * literal value rather than its presence for exactly that reason.
 *
 * `amountExpectedTo` is the "you will receive" figure the wallet renders, so
 * it must be `withdrawal.expected_amount`; `withdrawal.amount` is what was
 * actually sent and is meaningless until the order settles.
 */

/**
 * Maps a raw StealthEX status string to the canonical set the FE renders.
 *
 * The upstream enum is exactly: `waiting`, `confirming`, `exchanging`,
 * `sending`, `verifying`, `finished`, `failed`, `refunded`, `expired`
 * (StealthEX API reference, `Exchange.status`). All nine are mapped here.
 *
 * Two rules earn their comment:
 *
 * - `expired` is terminal. It used to fall through to `inProgress`, and the
 *   wallet polls anything in progress for 24 hours while telling the user
 *   their funds are on the way — for an order that will never happen.
 * - An unrecognized value is `unknown`, not `inProgress`. Claiming progress
 *   for a status we do not understand is the same failure in slower motion,
 *   and `unknown` is what the wallet's own type already documents.
 *
 * @param {string} status - raw StealthEX status
 * @returns {'inProgress'|'success'|'fail'|'refunded'|'unknown'}
 */
const getStatus = (status) => {
  const inProgressStatus = ['waiting', 'confirming', 'exchanging', 'sending', 'verifying'];
  if (inProgressStatus.includes(status)) {
    return 'inProgress';
  }
  switch (status) {
    case 'finished':
      return 'success';
    case 'failed':
      return 'fail';
    case 'expired':
      return 'fail';
    case 'refunded':
      return 'refunded';
    default:
      return 'unknown';
  }
};

/**
 * Coerce an upstream amount (string or number) to a number, or undefined
 * when absent/unparseable — the contract never emits NaN.
 * @param {string|number|null|undefined} value
 * @returns {number|undefined}
 */
const toAmount = (value) => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * @param {Object} exch - Raw StealthEX exchange record.
 * @returns {Promise<Object>} camelCase public bridge-exchange shape.
 */
module.exports = async (exch) => {
  const { id, status, refund_address, created_at, deposit = {}, withdrawal = {} } = exch;

  // The public symbol vocabulary is the v2 ticker, which v4 carries as
  // `legacy_symbol`; raw v4 symbols are not unique (`usdc` names several
  // currencies) and the wallet keys token identity off this string. The
  // service resolves it before handing the record over — a resource that has
  // to fetch a catalogue to format a field is a resource doing I/O.
  return {
    id,
    currencyFrom: deposit.legacy_symbol || deposit.symbol,
    currencyTo: withdrawal.legacy_symbol || withdrawal.symbol,
    amountExpectedFrom: toAmount(deposit.expected_amount),
    amountExpectedTo: toAmount(withdrawal.expected_amount),
    amountFrom: toAmount(deposit.amount),
    amountTo: toAmount(withdrawal.amount),
    payinAddress: deposit.address,
    payinExtraId: deposit.extra_id,
    payoutAddress: withdrawal.address,
    payoutExtraId: withdrawal.extra_id,
    payinHash: deposit.tx_hash,
    payoutHash: withdrawal.tx_hash,
    refundAddress: refund_address,
    status: getStatus(status),
    createdAt: created_at,
    // v4 has no updated-at on an exchange. `null` rather than `undefined` so
    // the key survives JSON serialization — dropping a key is a wire change,
    // emitting a null value is not. Nothing in the wallet reads it.
    updatedAt: null,
  };
};
