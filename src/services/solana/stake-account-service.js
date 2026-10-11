'use strict';

/**
 * The SOL stake accounts a wallet manages (spec 020).
 *
 * A stake account holds SOL delegated to a validator; the wallet is its
 * staker or its withdrawer authority. They are found with two filtered
 * `getProgramAccounts` reads on the Stake program — the staker sits at byte
 * 12 of the account and the withdrawer at byte 44 — and deduplicated, since
 * the same wallet is usually both.
 *
 * Read-only: nothing here builds a transaction.
 */

const axios = require('axios');
const { getRpcUrl } = require('../../infrastructure/triton-client');
const { providerCall } = require('../../infrastructure/providers/provider-client');
const coingecko = require('../shared/coingecko-service');
const catalog = require('./token-catalog-service');
const {
  getCacheKeyFor,
  getFromCache,
  storeInCache,
} = require('../../infrastructure/cache/cache-helper');

// Prices of native SOL are quoted under the wrapped-SOL mint.
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';
const CONFIG_PROGRAM = 'Config1111111111111111111111111111111111111';
const STAKER_OFFSET = 12;
const WITHDRAWER_OFFSET = 44;
const STAKE_ACCOUNT_SIZE = 200;
// A validator-info record lists two keys: the info marker, then the
// validator's identity, which starts after the 1-byte count and the 33-byte
// first entry.
const VALIDATOR_IDENTITY_OFFSET = 34;

/** `deactivationEpoch` of a stake that is not deactivating. */
const MAX_U64 = '18446744073709551615';

const REWARD_EPOCHS = 5;
// A completed epoch's reward never changes.
const REWARD_TTL_SECONDS = 30 * 24 * 60 * 60;
const VALIDATOR_TTL_SECONDS = 24 * 60 * 60;
// Validator names and icons are whatever the operator published.
const MAX_NAME_LENGTH = 64;
const REQUEST_TIMEOUT = 10000;

/** USD price of `mint`, or null: a missing price never fails the read. */
const usdPriceOf = async (mint, locals) => {
  try {
    return (await coingecko.getTokenPrices([mint], locals)).get(mint)?.usdPrice ?? null;
  } catch (error) {
    console.warn(`[STAKING_PRICE] no price for ${mint}: ${error.message}`);
    return null;
  }
};

const rpc = async (method, params, locals) => {
  const environment = locals?.network?.environment || 'mainnet';
  const { data } = await providerCall(
    'triton',
    ({ timeout, signal }) =>
      axios.post(
        getRpcUrl(environment),
        { jsonrpc: '2.0', id: `stake-${method}`, method, params },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: Math.min(REQUEST_TIMEOUT, timeout),
          signal,
        }
      ),
    { locals, environment, operationName: `Solana ${method} (stake accounts)` }
  );
  if (data?.error) {
    throw new Error(`${method} failed: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return data?.result;
};

/**
 * activating / active / deactivating / inactive, from the delegation's
 * epochs against the current one.
 *
 * ponytail: epoch comparison only. When the whole cluster activates more than
 * the warm-up rate allows, a stake takes several epochs to become fully
 * active and reads `active` a little early; exact figures need the
 * StakeHistory sysvar walk.
 *
 * @param {{activationEpoch: number, deactivationEpoch: number|null}|null} delegation
 * @param {number} epoch - current epoch.
 * @returns {'activating'|'active'|'deactivating'|'inactive'}
 */
const stakeState = (delegation, epoch) => {
  if (!delegation) return 'inactive';
  const { activationEpoch, deactivationEpoch } = delegation;
  if (deactivationEpoch !== null) return deactivationEpoch >= epoch ? 'deactivating' : 'inactive';
  return activationEpoch >= epoch ? 'activating' : 'active';
};

const listByAuthority = (address, offset, locals) =>
  rpc(
    'getProgramAccounts',
    [
      STAKE_PROGRAM,
      {
        encoding: 'jsonParsed',
        filters: [{ dataSize: STAKE_ACCOUNT_SIZE }, { memcmp: { offset, bytes: address } }],
      },
    ],
    locals
  );

const toAccount = ({ pubkey, account }) => {
  const delegation = account.data?.parsed?.info?.stake?.delegation ?? null;
  return {
    address: pubkey,
    lamports: account.lamports,
    delegatedLamports: delegation?.stake ?? null,
    voter: delegation?.voter ?? null,
    activationEpoch: delegation ? Number(delegation.activationEpoch) : null,
    deactivationEpoch:
      delegation && delegation.deactivationEpoch !== MAX_U64
        ? Number(delegation.deactivationEpoch)
        : null,
  };
};

const cached = async (key, ttl, load) => {
  const hit = await getFromCache(key);
  if (hit) return hit.value;
  const value = await load();
  await storeInCache(key, { value }, ttl);
  return value;
};

const safeName = (name) =>
  typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME_LENGTH) : null;
const safeIcon = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);

/** `{ name, iconUrl }` a validator published for its vote account, or null. */
const validatorFor = (voter, locals) =>
  cached(
    getCacheKeyFor('stake_validator', 'voter', voter, locals),
    VALIDATOR_TTL_SECONDS,
    async () => {
      const votes = await rpc('getVoteAccounts', [{ votePubkey: voter }], locals);
      const identity = [...(votes?.current ?? []), ...(votes?.delinquent ?? [])].find(
        (v) => v.votePubkey === voter
      )?.nodePubkey;
      if (!identity) return null;
      const records = await rpc(
        'getProgramAccounts',
        [
          CONFIG_PROGRAM,
          {
            encoding: 'jsonParsed',
            filters: [{ memcmp: { offset: VALIDATOR_IDENTITY_OFFSET, bytes: identity } }],
          },
        ],
        locals
      );
      const info = (records ?? []).find((r) => r.account?.data?.parsed?.type === 'validatorInfo')
        ?.account.data.parsed.info.configData;
      const name = safeName(info?.name);
      return name ? { name, iconUrl: safeIcon(info.iconUrl) } : null;
    }
  );

/** True when the stake earned during `epoch`. */
const earnedIn = (account, epoch) =>
  account.activationEpoch !== null &&
  account.activationEpoch < epoch &&
  (account.deactivationEpoch === null || epoch <= account.deactivationEpoch);

const rewardKey = (address, epoch, locals) =>
  getCacheKeyFor('stake_reward', `epoch_${epoch}`, address, locals);

/**
 * The reward each account earned in each of the last completed epochs,
 * `Map<address, [{ epoch, lamports, postBalance }]>`, newest first. One call
 * per epoch for every account that earned in it; each answer is cached.
 */
const rewardsFor = async (accounts, epoch, locals) => {
  const rewards = new Map(accounts.map((a) => [a.address, []]));
  for (let e = epoch - 1; e >= epoch - REWARD_EPOCHS; e -= 1) {
    const earning = accounts.filter((a) => earnedIn(a, e));
    const missing = [];
    for (const account of earning) {
      const hit = await getFromCache(rewardKey(account.address, e, locals));
      if (hit) {
        if (hit.reward) rewards.get(account.address).push(hit.reward);
      } else {
        missing.push(account);
      }
    }
    if (missing.length === 0) continue;
    const answers = await rpc(
      'getInflationReward',
      [missing.map((a) => a.address), { epoch: e }],
      locals
    );
    for (const [i, account] of missing.entries()) {
      const answer = answers?.[i];
      const reward = answer
        ? { epoch: e, lamports: answer.amount, postBalance: answer.postBalance }
        : null;
      if (reward) rewards.get(account.address).push(reward);
      await storeInCache(rewardKey(account.address, e, locals), { reward }, REWARD_TTL_SECONDS);
    }
  }
  return rewards;
};

/**
 * @param {string} address - wallet.
 * @param {Object} locals - Express `res.locals`.
 * @returns {Promise<{epoch: number, accounts: Array<Object>}>}
 */
const listStakeAccounts = async (address, locals) => {
  const [asStaker, asWithdrawer, epochInfo] = await Promise.all([
    listByAuthority(address, STAKER_OFFSET, locals),
    listByAuthority(address, WITHDRAWER_OFFSET, locals),
    rpc('getEpochInfo', [], locals),
  ]);
  const { epoch } = epochInfo;
  const unique = new Map([...(asStaker ?? []), ...(asWithdrawer ?? [])].map((a) => [a.pubkey, a]));
  const accounts = [...unique.values()].map(toAccount);
  if (accounts.length === 0) return { epoch, accounts, usdPrice: null };

  const voters = [...new Set(accounts.map((a) => a.voter).filter(Boolean))];
  const [validators, rewards, usdPrice, logo] = await Promise.all([
    Promise.all(voters.map((voter) => validatorFor(voter, locals))),
    rewardsFor(accounts, epoch, locals),
    usdPriceOf(WRAPPED_SOL_MINT, locals),
    // SOL's logo, so the Staked SOL row has one whatever the wallet lists.
    catalog.logoOf(WRAPPED_SOL_MINT),
  ]);
  const validatorByVoter = new Map(voters.map((voter, i) => [voter, validators[i]]));

  return {
    epoch,
    usdPrice,
    logo,
    accounts: accounts.map((account) => ({
      ...account,
      state: stakeState(account.activationEpoch === null ? null : account, epoch),
      validator: account.voter ? (validatorByVoter.get(account.voter) ?? null) : null,
      rewards: rewards.get(account.address),
    })),
  };
};

module.exports = { listStakeAccounts, stakeState, MAX_U64 };
