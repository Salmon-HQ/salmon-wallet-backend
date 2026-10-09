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

describe('exactHistory', () => {
  const { exactHistory } = require('../skr-staking-service');
  const DAY = 24 * 60 * 60 * 1000;
  const D1 = Date.parse('2026-10-10T00:05:00Z');
  const D2 = D1 + DAY;
  const D3 = D2 + DAY;
  // Share prices at the scale the program keeps (10^9 = 1.0).
  const records = [
    { at: D1, sharePrice: '1000000000' },
    { at: D2, sharePrice: '1100000000' },
    { at: D3, sharePrice: '1200000000' },
  ];

  test('pays the shares held each day the growth of that day', () => {
    // 100 SKR of shares (6 decimals) gain 0.1 per day: 10 SKR a day.
    expect(exactHistory(records, [], 100000000n)).toEqual([
      { at: D3, earned: 10000000n },
      { at: D2, earned: 10000000n },
    ]);
  });

  test('counts the shares a stake added only from the moment they were added', () => {
    // 100 shares until noon of the first day, when 50 more were minted at 1.05.
    const staked = { at: D1 + DAY / 2, sharesDelta: 50000000n, sharePrice: 1050000000n };

    expect(exactHistory(records, [staked], 150000000n)).toEqual([
      // 150 × 0.1
      { at: D3, earned: 15000000n },
      // 100 × (1.05 − 1.0) + 150 × (1.10 − 1.05)
      { at: D2, earned: 12500000n },
    ]);
  });

  test('stops counting unstaked shares from the moment they left', () => {
    const unstaked = { at: D2 + DAY / 2, sharesDelta: -40000000n, sharePrice: 1150000000n };

    expect(exactHistory(records, [unstaked], 60000000n)).toEqual([
      // 100 × (1.15 − 1.10) + 60 × (1.20 − 1.15)
      { at: D3, earned: 8000000n },
      { at: D2, earned: 10000000n },
    ]);
  });

  test('leaves out a day without growth, and anything before the first record', () => {
    const flat = [
      { at: D1, sharePrice: '1000000000' },
      { at: D2, sharePrice: '1000000000' },
      { at: D3, sharePrice: '1100000000' },
    ];
    const before = { at: D1 - DAY, sharesDelta: 100000000n, sharePrice: 900000000n };

    expect(exactHistory(flat, [before], 100000000n)).toEqual([{ at: D3, earned: 10000000n }]);
  });
});

describe('decodeStakeEvent', () => {
  const { decodeStakeEvent } = require('../skr-staking-service');
  const bs58 = require('bs58').default || require('bs58');
  const { PublicKey } = require('@solana/web3.js');
  // The event instruction of CzNRNm6v…'s stake, 2026-01-21 (mainnet): 40,000
  // SKR deposited at share price 1.0.
  const STAKED =
    'q7FXAAedM1BCdFtfQV7d4NvcKWJq4qRETZazp8e2QL5ezK2PG3PmbjPLQzayLJdBArdHFK2imKRbMNKyBLjAkCjfSW24HiSR79JG1dSyLLwVVSCdFqE8ztW32h7GKJSFcc1qN81A99mz5ySVSsm5fQnrSLJenhUMrnE1PRihxR5JK56AvfhYKkmf1WaLYf6d5PbSexaB9XhHXBTY3zTN5FizqSGKJjYAUPTnzTM7EBXVjZGJCszJbKpJAwZ9uHFa7R4yMFU6iSq8gukZh29ejyyEQ9A2oNTaHMgECEB';

  // Builds an event as the program emits it (layout from the on-chain IDL).
  const u128 = (v) => {
    const b = Buffer.alloc(16);
    b.writeBigUInt64LE(v & ((1n << 64n) - 1n), 0);
    b.writeBigUInt64LE(v >> 64n, 8);
    return b;
  };
  const key = (seed) => new PublicKey(Buffer.alloc(32, seed)).toBuffer();
  const USER = key(7);
  const event = (disc, ...tail) =>
    Buffer.concat([
      Buffer.from('e445a52e51cb9a1d', 'hex'),
      Buffer.from(disc),
      key(1),
      key(2),
      key(3),
      USER,
      key(5),
      ...tail,
    ]);

  test('reads a stake: the shares it minted, at its share price', () => {
    expect(decodeStakeEvent(Buffer.from(bs58.decode(STAKED)))).toEqual({
      kind: 'staked',
      position: '7yFnVkeEk4Qd6jgGsjrU4rhYDd7UQ985ah1VgWNg8m58',
      user: 'CzNRNm6vbDiJ2MG96Lw4gSZW1gSjeV6DgSEAjCULxXcJ',
      sharesDelta: 40000000000n,
      sharePrice: 1000000000n,
    });
  });

  test('reads an unstake as shares leaving, and a cancel as shares coming back', () => {
    const ts = Buffer.alloc(8);
    ts.writeBigInt64LE(1791500000n);
    const unstaked = event(
      [27, 179, 156, 215, 47, 71, 195, 7],
      u128(5000000n),
      u128(1150000000n),
      ts
    );
    const cancelled = event(
      [102, 223, 189, 101, 201, 223, 180, 38],
      u128(5000000n),
      u128(1160000000n)
    );

    expect(decodeStakeEvent(unstaked)).toMatchObject({
      kind: 'unstaked',
      sharesDelta: -5000000n,
      sharePrice: 1150000000n,
    });
    expect(decodeStakeEvent(cancelled)).toMatchObject({
      kind: 'cancelled',
      sharesDelta: 5000000n,
      sharePrice: 1160000000n,
    });
  });

  test('ignores anything that is not a share-changing event', () => {
    expect(decodeStakeEvent(Buffer.from('not an event'))).toBeNull();
    // Withdrawn moves SKR out, not shares.
    expect(decodeStakeEvent(event([20, 89, 223, 198, 194, 124, 219, 13]))).toBeNull();
  });
});

describe('payoutSchedule', () => {
  const { payoutSchedule } = require('../skr-staking-service');
  // The inflation program's state as recorded on mainnet (2026-10-09), after
  // its 129th payout, which ran 2026-10-08 02:00:09 UTC.
  const INFLATION_STATE = Buffer.from(
    'XdCdJsY+qC34AADBb/KGIwBAQg8AQA0DAIc9AAAAowIAAAAAAA7WcmkAAAAABnxaPgX+QUcSp6Lq/kK+dhC82Qy/VxYndYNzy4rQ2KRyu7dx8SlU4vf0IZe+LPhOHZcnRNe9vEQbSkmef38tk/ff0ZgViKFCpwQiaac97Q9yoqptfcBpTa38aqOfCp8jAAAAAAAAAAAAAAAAAAAAAACBAAAAAAAAAAB2XVQcSwIA',
    'base64'
  );

  test('reads the payout interval and when the last payout and the next one are due', () => {
    expect(payoutSchedule(INFLATION_STATE)).toEqual({
      intervalSeconds: 172800,
      lastAt: Date.parse('2026-10-08T01:59:42Z'),
      nextAt: Date.parse('2026-10-10T01:59:42Z'),
    });
  });
});
