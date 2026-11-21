'use strict';

/**
 * Abuse case: regular-expression denial of service (ReDoS). An NFT name is
 * written by whoever mints it and airdropped into any wallet, and the listing
 * scores every name on the request path. A pattern that backtracks over a
 * crafted name holds the Lambda for seconds per item, so scoring must stay
 * linear in the name's length.
 */

const { score, countNames } = require('../nft-spam-detector');

// A quadratic pattern needs minutes for these sizes; a linear one, milliseconds.
const BUDGET_MS = 1000;
const elapsedMs = (run) => {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1e6;
};

describe('abuse: a crafted NFT name that stalls the spam score', () => {
  test.each([
    ['"redeem" repeated, never followed by "voucher"', 'redeem'.repeat(30_000)],
    ['spaces before a "#" that no edition number follows', `box${' '.repeat(100_000)}#x`],
    ['"#" repeated', '# '.repeat(50_000)],
  ])('%s is scored in linear time', (_label, name) => {
    expect(elapsedMs(() => score({ name }))).toBeLessThan(BUDGET_MS);
    expect(elapsedMs(() => countNames([{ name }]))).toBeLessThan(BUDGET_MS);
  });

  test('the voucher bait is still caught, wherever the two words sit', () => {
    const fires = (name) => score({ name }).spamReasons.includes('spam_name_keyword');

    expect(fires('Redeem your 500 USDC Voucher')).toBe(true);
    expect(fires(`redeem ${'x'.repeat(5000)} voucher`)).toBe(true);
    expect(fires('Voucher to redeem')).toBe(false);
  });

  test('editions of one name still count as one name', () => {
    expect(countNames([{ name: 'BOX #43' }, { name: 'box#64' }, { name: 'Box # 7' }])).toEqual({
      box: 3,
    });
  });
});
