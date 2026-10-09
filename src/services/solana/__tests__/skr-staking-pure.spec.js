'use strict';

/**
 * SKR staking accounts as recorded on mainnet (2026-10-08) for
 * CzNRNm6v…: 40,000 SKR staked at share price 1.0, now worth 46,045.7 SKR —
 * the 46,046 the Seed Vault Wallet shows.
 */

const {
  decodeUserStake,
  decodeStakeConfig,
  decodeGuardianPool,
  positionValues,
  historyFrom,
  apyFrom,
} = require('../skr-staking-service');

const USER_STAKE = Buffer.from(
  'ZjWjawmKV5n+MMd0OFYtRe9beSkvYc8PNRQ1nYzgszbll2atCImxvN6yIuHcuiojh5VFAnTHMZqEqeXH+9oVh5p2yLbnjozFn7gCUtGNtSuONRWJvQL7jRyzJlcF9a4LANKbp5jhwl3hAJAvUAkAAAAAAAAAAAAAAADKmjsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  'base64'
);
const STAKE_CONFIG = Buffer.from(
  '7pcrAwuXP7D/99/RmBWIoUKnBCJppz3tD3Kiqm19wGlNrfxqo58KnyMGfFo+Bf5BRxKnour+Qr52ELzZDL9XFid1g3PLitDYpHK7t3HxKVTi9/Qhl74s+E4dlydE1728RBtKSZ5/fy2TQEIPAAAAAAAAowIAAAAAAAxIb2O1gw8AAAAAAAAAAAAWC51EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACa+OAN8PIRAA==',
  'base64'
);
const GUARDIAN_POOL = Buffer.from(
  'he7/1tcLvRcwx3Q4Vi1F71t5KS9hzw81FDWdjOCzNuWXZq0IibG83gZ8WJTOnorbS50M0/6yYuuZboUVKKTmfwK8/8Gr9hNs99/RmBWIoUKnBCJppz3tD3Kiqm19wGlNrfxqo58KnyMMSG9jtYMPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYLnUQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AQAAAAAAAAAAAAAAAAAAAAA=',
  'base64'
);

describe('decoders', () => {
  test('read the position', () => {
    expect(decodeUserStake(USER_STAKE)).toEqual({
      stakeConfig: '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw',
      user: 'CzNRNm6vbDiJ2MG96Lw4gSZW1gSjeV6DgSEAjCULxXcJ',
      guardianPool: 'DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr',
      shares: 40000000000n,
      costBasis: 1000000000n,
      unstakingAmount: 0n,
      unstakeTimestamp: 0,
    });
  });

  test('read the global configuration', () => {
    expect(decodeStakeConfig(STAKE_CONFIG)).toMatchObject({
      mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
      cooldownSeconds: 172800,
      totalShares: 4366939731216396n,
      sharePrice: 1151142678n,
    });
  });

  test('read the guardian pool', () => {
    expect(decodeGuardianPool(GUARDIAN_POOL)).toEqual({ commissionBps: 0, active: true });
  });
});

describe('positionValues', () => {
  test('values the position at the current share price, and what it earned', () => {
    expect(positionValues({ shares: 40000000000n, costBasis: 1000000000n }, 1151142678n)).toEqual({
      staked: 46045707120n,
      earned: 6045707120n,
    });
  });
});

describe('historyFrom', () => {
  const day = (iso, sharePrice) => ({ at: Date.parse(iso), sharePrice: String(sharePrice) });

  test('lists what the shares earned between consecutive records, newest first', () => {
    const records = [
      day('2026-10-06T10:00:00Z', 1150000000),
      day('2026-10-08T10:00:00Z', 1151142678),
      day('2026-10-07T10:00:00Z', 1150500000),
    ];

    expect(historyFrom(records, 40000000000n, null)).toEqual([
      { at: Date.parse('2026-10-08T10:00:00Z'), earned: 25707120n },
      { at: Date.parse('2026-10-07T10:00:00Z'), earned: 20000000n },
    ]);
  });

  test('counts nothing before the stake existed', () => {
    const records = [
      day('2026-10-06T10:00:00Z', 1150000000),
      day('2026-10-08T10:00:00Z', 1151142678),
    ];

    expect(historyFrom(records, 40000000000n, Date.parse('2026-10-07T00:00:00Z'))).toEqual([]);
  });
});

describe('apyFrom', () => {
  test('annualizes the growth over at least seven days of records', () => {
    const records = [
      { at: Date.parse('2026-09-28T00:00:00Z'), sharePrice: '1000000000' },
      { at: Date.parse('2026-10-08T00:00:00Z'), sharePrice: '1003900000' },
    ];
    // (1.0039)^(365.25/10) - 1 ≈ 0.1528
    expect(apyFrom(records)).toBeCloseTo(0.1528, 3);
  });

  test('is null with less than seven days of records', () => {
    expect(
      apyFrom([
        { at: Date.parse('2026-10-06T00:00:00Z'), sharePrice: '1000000000' },
        { at: Date.parse('2026-10-08T00:00:00Z'), sharePrice: '1001000000' },
      ])
    ).toBeNull();
  });
});
