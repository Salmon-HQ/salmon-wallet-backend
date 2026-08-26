'use strict';

const bridgeExchangeResource = require('../bridge-exchange-resource');

// v4 splits the flat v2 record into `deposit` / `withdrawal`. The two sides use
// deliberately different, chain-appropriate addresses: they are structurally
// identical, so a fixture with symmetric values would let a deposit/withdrawal
// mix-up pass every assertion — and that mix-up sends user funds to the wrong
// address.
const RAW_STEALTHEX_EXCHANGE = {
  id: 'x1',
  status: 'waiting',
  rate: 'floating',
  refund_address: 'Refund333',
  refund_extra_id: null,
  created_at: '2026-08-11T00:00:00.000Z',
  expires_at: null,
  deposit: {
    symbol: 'sol',
    network: 'mainnet',
    legacy_symbol: 'sol',
    amount: 1.5,
    expected_amount: 1.5,
    address: 'SoLDepositAddr111',
    extra_id: null,
    tx_hash: 'hash-in',
  },
  withdrawal: {
    symbol: 'btc',
    network: 'mainnet',
    legacy_symbol: 'btc',
    amount: 0.00214,
    expected_amount: 0.00214,
    address: 'bc1qpayoutaddr222',
    extra_id: 'memo-9',
    tx_hash: 'hash-out',
  },
};

describe('bridge-exchange-resource', () => {
  it('maps the raw StealthEX shape to the camelCase public contract', async () => {
    const resource = await bridgeExchangeResource(RAW_STEALTHEX_EXCHANGE);

    expect(resource).toEqual({
      id: 'x1',
      currencyFrom: 'sol',
      currencyTo: 'btc',
      amountExpectedFrom: 1.5,
      amountExpectedTo: 0.00214,
      amountFrom: 1.5,
      amountTo: 0.00214,
      payinAddress: 'SoLDepositAddr111',
      payinExtraId: null,
      payoutAddress: 'bc1qpayoutaddr222',
      payoutExtraId: 'memo-9',
      payinHash: 'hash-in',
      payoutHash: 'hash-out',
      refundAddress: 'Refund333',
      status: 'inProgress',
      createdAt: '2026-08-11T00:00:00.000Z',
      // v4 has no updated-at on an exchange. Null keeps the key on the wire.
      updatedAt: null,
    });
  });

  it('takes payinAddress from the deposit side, by literal value', async () => {
    // The deposit address is where the user's funds go. `deposit` and
    // `withdrawal` are structurally identical, so this assertion is on the
    // exact string rather than on presence: a mix-up would otherwise pass.
    const resource = await bridgeExchangeResource(RAW_STEALTHEX_EXCHANGE);

    expect(resource.payinAddress).toBe('SoLDepositAddr111');
    expect(resource.payoutAddress).toBe('bc1qpayoutaddr222');
  });

  it('reports the expected payout, not the settled one', async () => {
    // `withdrawal.amount` is what was actually sent, which is 0 on a fresh
    // order; `amountExpectedTo` is rendered to the user as "you will receive".
    const resource = await bridgeExchangeResource({
      ...RAW_STEALTHEX_EXCHANGE,
      withdrawal: { ...RAW_STEALTHEX_EXCHANGE.withdrawal, amount: 0, expected_amount: 0.00214 },
    });

    expect(resource.amountExpectedTo).toBe(0.00214);
    expect(resource.amountTo).toBe(0);
  });

  it('emits the legacy ticker the service resolved, falling back to the raw symbol', async () => {
    const resource = await bridgeExchangeResource({
      ...RAW_STEALTHEX_EXCHANGE,
      deposit: { ...RAW_STEALTHEX_EXCHANGE.deposit, symbol: 'usdc', legacy_symbol: 'usdcsol' },
      withdrawal: { ...RAW_STEALTHEX_EXCHANGE.withdrawal, legacy_symbol: undefined },
    });

    expect(resource.currencyFrom).toBe('usdcsol');
    expect(resource.currencyTo).toBe('btc');
  });

  it.each([
    ['waiting', 'inProgress'],
    ['confirming', 'inProgress'],
    ['exchanging', 'inProgress'],
    ['sending', 'inProgress'],
    ['verifying', 'inProgress'],
    ['finished', 'success'],
    ['failed', 'fail'],
    ['refunded', 'refunded'],
    // Terminal upstream: the order timed out and will never happen. Reporting
    // progress kept the wallet polling it for 24h while telling the user their
    // funds were on the way.
    ['expired', 'fail'],
    // Not in StealthEX's documented enum: say so instead of claiming progress.
    ['something-new', 'unknown'],
  ])('normalizes upstream status %s to %s', async (raw, normalized) => {
    const resource = await bridgeExchangeResource({ ...RAW_STEALTHEX_EXCHANGE, status: raw });
    expect(resource.status).toBe(normalized);
  });

  it('covers every status in the documented upstream enum', async () => {
    // StealthEX API reference, `Exchange.status`.
    const documented = [
      'waiting',
      'confirming',
      'exchanging',
      'sending',
      'verifying',
      'finished',
      'failed',
      'refunded',
      'expired',
    ];

    const normalized = await Promise.all(
      documented.map(
        async (status) =>
          (await bridgeExchangeResource({ ...RAW_STEALTHEX_EXCHANGE, status })).status
      )
    );

    expect(normalized).not.toContain('unknown');
  });

  it('keeps absent optional fields undefined and never emits NaN amounts', async () => {
    const resource = await bridgeExchangeResource({
      id: 'x2',
      status: 'waiting',
      deposit: { symbol: 'sol', network: 'mainnet', expected_amount: 2, address: 'Dep' },
      withdrawal: { symbol: 'btc', network: 'mainnet', address: 'Pay' },
    });

    expect(resource.amountExpectedFrom).toBe(2);
    expect(resource.amountExpectedTo).toBeUndefined();
    expect(resource.amountTo).toBeUndefined();
    expect(resource.payinHash).toBeUndefined();
    expect(resource.createdAt).toBeUndefined();
    expect(resource.updatedAt).toBeNull();
    expect(Object.values(resource).some((v) => Number.isNaN(v))).toBe(false);
  });

  it('survives an exchange with no deposit or withdrawal block', async () => {
    // Defensive: the service validates `id` before handing the record over, so
    // this should not happen — but a formatter that throws takes down the
    // whole response instead of one field.
    const resource = await bridgeExchangeResource({ id: 'x4', status: 'waiting' });

    expect(resource.id).toBe('x4');
    expect(resource.payinAddress).toBeUndefined();
  });
});
