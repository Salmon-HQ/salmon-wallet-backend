'use strict';

/**
 * Public shape of `GET /account/:address/stakes` (spec 020). Lamport amounts
 * are strings, like every other base-unit amount this API returns.
 *
 * @param {{epoch: number, accounts: Array<Object>}} result - from `stake-account-service`.
 * @returns {{epoch: number, data: Array<Object>}}
 */
module.exports = ({ epoch, accounts, usdPrice }) => ({
  epoch,
  usdPrice: usdPrice ?? null,
  data: accounts.map((account) => ({
    address: account.address,
    lamports: String(account.lamports),
    delegatedLamports: account.delegatedLamports,
    voter: account.voter,
    validator: account.validator,
    activationEpoch: account.activationEpoch,
    deactivationEpoch: account.deactivationEpoch,
    state: account.state,
    rewards: account.rewards.map((reward) => ({
      epoch: reward.epoch,
      lamports: String(reward.lamports),
      postBalance: String(reward.postBalance),
    })),
  })),
});
