'use strict';

/**
 * Public shape of `GET /skr/stake` (spec 021). SKR amounts are base-unit
 * strings (6 decimals); times are epoch milliseconds.
 *
 * @param {Object} result - from `skr-staking-service.getSkrStake`.
 * @returns {Object}
 */
module.exports = (result) => ({
  mint: result.mint,
  decimals: 6,
  sharePrice: String(result.sharePrice),
  cooldownSeconds: result.cooldownSeconds,
  apy: result.apy,
  usdPrice: result.usdPrice ?? null,
  liquid: String(result.liquid ?? 0n),
  totalStaked: String(result.totalStaked),
  logo: result.logo ?? null,
  // When the last payout fell due and the next one does, from the inflation
  // program's own schedule.
  payouts: result.payouts ?? null,
  // Rewards are listed from this record on; null before the first one.
  historySince: result.historySince ?? null,
  positions: result.positions.map((position) => ({
    address: position.address,
    staked: String(position.staked),
    earned: String(position.earned),
    guardian: position.guardian,
    unstaking: position.unstaking
      ? {
          amount: String(position.unstaking.amount),
          withdrawableAt: position.unstaking.withdrawableAt,
        }
      : null,
    stakedSince: position.stakedSince,
    history: position.history.map((entry) => ({ at: entry.at, earned: String(entry.earned) })),
  })),
});
