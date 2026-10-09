'use strict';

/**
 * Stake accounts of a wallet, against shapes recorded on mainnet
 * (2026-10-08) for CzNRNm6v…, which stakes 1.0025 SOL with the Salmon Wallet
 * validator.
 */

jest.mock('axios');
jest.mock('../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((_name, run) => run({ timeout: 10000, signal: undefined })),
}));
jest.mock('../../../infrastructure/cache/cache-helper', () => {
  const store = new Map();
  return {
    __store: store,
    getCacheKeyFor: (entity, property, value) => `${entity}:${property}:${value}`,
    getFromCache: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    storeInCache: jest.fn(async (key, value) => store.set(key, value)),
  };
});

jest.mock('../../shared/coingecko-service', () => ({ getTokenPrices: jest.fn() }));
jest.mock('../token-catalog-service', () => ({ logoOf: jest.fn() }));

const axios = require('axios');
const coingecko = require('../../shared/coingecko-service');
const catalog = require('../token-catalog-service');
const cache = require('../../../infrastructure/cache/cache-helper');
const { listStakeAccounts, stakeState, MAX_U64 } = require('../stake-account-service');

const WALLET = 'CzNRNm6vbDiJ2MG96Lw4gSZW1gSjeV6DgSEAjCULxXcJ';
const STAKE = 'E5zHk2dnsnk6bL94BPe3svRczbT6WfZnmcQm3wVVEQRs';
const VOTER = 'Sa1HXZsn2u6p2dMLZGhfxtsRw7Jo32hF15yBghWJsCz';
const IDENTITY = 'SA1LFXr4os2P4VKGUyRv84uFfuUYgcQkFh2uA4SmRcr';
const locals = { network: { environment: 'mainnet', id: 'solana-mainnet' } };

const stakeAccount = (pubkey = STAKE, delegation = true) => ({
  pubkey,
  account: {
    lamports: 1002513301,
    data: {
      program: 'stake',
      parsed: {
        type: delegation ? 'delegated' : 'initialized',
        info: {
          meta: {
            authorized: { staker: WALLET, withdrawer: WALLET },
            rentExemptReserve: '2282880',
          },
          ...(delegation && {
            stake: {
              delegation: {
                activationEpoch: '1046',
                deactivationEpoch: MAX_U64,
                stake: '1000847061',
                voter: VOTER,
              },
            },
          }),
        },
      },
    },
  },
});

const validatorInfo = (configData) => ({
  pubkey: 'BeBngxrY8N4yTx5ebnpSvH9syT9L4WNqh7MMenryzMre',
  account: {
    data: {
      parsed: {
        type: 'validatorInfo',
        info: {
          configData,
          keys: [
            { pubkey: 'Va1idator1nfo111111111111111111111111111111', signer: false },
            { pubkey: IDENTITY, signer: true },
          ],
        },
      },
    },
  },
});

/** Answers each JSON-RPC method from `answers`, recording the calls. */
const rpcWith = (answers) => {
  axios.post.mockImplementation(async (_url, body) => {
    const answer = answers[body.method];
    const result = typeof answer === 'function' ? answer(body.params) : answer;
    return { data: { result } };
  });
};
const calls = (method) => axios.post.mock.calls.filter(([, body]) => body.method === method);

const defaults = (overrides = {}) => ({
  getEpochInfo: { epoch: 1052 },
  getProgramAccounts: ([program, config]) => {
    if (program.startsWith('Config')) {
      return [
        validatorInfo({
          name: 'Salmon Wallet',
          iconUrl: 'https://i.ibb.co/d4MQcwKL/salmon.png',
          website: 'https://www.salmonwallet.io/',
        }),
      ];
    }
    const offset = config.filters.find((f) => f.memcmp).memcmp.offset;
    return offset === 12 || offset === 44 ? [stakeAccount()] : [];
  },
  getVoteAccounts: { current: [{ votePubkey: VOTER, nodePubkey: IDENTITY }], delinquent: [] },
  getInflationReward: ([addresses, { epoch }]) =>
    addresses.map(() => ({ epoch, amount: 169000 + epoch, postBalance: 1000000000 + epoch })),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  cache.__store.clear();
  coingecko.getTokenPrices.mockResolvedValue(
    new Map([['So11111111111111111111111111111111111111112', { usdPrice: 108.2 }]])
  );
  process.env.TRITON_RPC_URL = 'https://triton.example/token';
});

describe('stakeState', () => {
  const at = (activationEpoch, deactivationEpoch = null) => ({
    activationEpoch,
    deactivationEpoch,
  });

  test.each([
    ['activating in the epoch it was delegated', at(1052), 'activating'],
    ['active once that epoch is over', at(1046), 'active'],
    ['deactivating in the epoch it was undelegated', at(1046, 1052), 'deactivating'],
    ['inactive after that', at(1046, 1050), 'inactive'],
    ['inactive when never delegated', null, 'inactive'],
  ])('is %s', (_name, delegation, expected) => {
    expect(stakeState(delegation, 1052)).toBe(expected);
  });
});

describe('listStakeAccounts', () => {
  test('lists the account once though the wallet is both staker and withdrawer', async () => {
    rpcWith(defaults());

    catalog.logoOf.mockResolvedValue('https://assets.coingecko.com/solana.jpg');

    const { epoch, accounts, usdPrice, logo } = await listStakeAccounts(WALLET, locals);

    expect(epoch).toBe(1052);
    expect(usdPrice).toBe(108.2);
    // SOL's logo, so the Staked SOL row has one whatever the wallet lists.
    expect(catalog.logoOf).toHaveBeenCalledWith('So11111111111111111111111111111111111111112');
    expect(logo).toBe('https://assets.coingecko.com/solana.jpg');
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      address: STAKE,
      lamports: 1002513301,
      delegatedLamports: '1000847061',
      voter: VOTER,
      activationEpoch: 1046,
      deactivationEpoch: null,
      state: 'active',
      validator: { name: 'Salmon Wallet', iconUrl: 'https://i.ibb.co/d4MQcwKL/salmon.png' },
    });
    const offsets = calls('getProgramAccounts')
      .filter(([, b]) => b.params[0].startsWith('Stake'))
      .map(([, b]) => b.params[1].filters.find((f) => f.memcmp).memcmp.offset)
      .sort();
    expect(offsets).toEqual([12, 44]);
  });

  test('carries the rewards of the last five completed epochs, newest first', async () => {
    rpcWith(defaults());

    const { accounts } = await listStakeAccounts(WALLET, locals);

    expect(accounts[0].rewards.map((r) => r.epoch)).toEqual([1051, 1050, 1049, 1048, 1047]);
    expect(accounts[0].rewards[0]).toEqual({
      epoch: 1051,
      lamports: 169000 + 1051,
      postBalance: 1000000000 + 1051,
    });
    expect(calls('getInflationReward')).toHaveLength(5);
  });

  test('reads a completed epoch once, then from the cache', async () => {
    rpcWith(defaults());
    await listStakeAccounts(WALLET, locals);
    axios.post.mockClear();

    await listStakeAccounts(WALLET, locals);

    expect(calls('getInflationReward')).toHaveLength(0);
  });

  test('leaves out an epoch the provider has no reward for', async () => {
    rpcWith(
      defaults({
        getInflationReward: ([addresses, { epoch }]) =>
          addresses.map(() => (epoch === 1050 ? null : { epoch, amount: 1, postBalance: 2 })),
      })
    );

    const { accounts } = await listStakeAccounts(WALLET, locals);

    expect(accounts[0].rewards.map((r) => r.epoch)).toEqual([1051, 1049, 1048, 1047]);
  });

  test('a stake account never delegated has no validator and no rewards', async () => {
    rpcWith(
      defaults({
        getProgramAccounts: ([program]) =>
          program.startsWith('Config') ? [] : [stakeAccount(STAKE, false)],
      })
    );

    const { accounts } = await listStakeAccounts(WALLET, locals);

    expect(accounts[0]).toMatchObject({ voter: null, validator: null, state: 'inactive' });
    expect(accounts[0].rewards).toEqual([]);
    expect(calls('getInflationReward')).toHaveLength(0);
  });

  test("keeps a validator's name short and drops an icon that is not https", async () => {
    rpcWith(
      defaults({
        getProgramAccounts: ([program]) =>
          program.startsWith('Config')
            ? [validatorInfo({ name: 'x'.repeat(200), iconUrl: 'http://evil.example/i.png' })]
            : [stakeAccount()],
      })
    );

    const { accounts } = await listStakeAccounts(WALLET, locals);

    expect(accounts[0].validator.name).toHaveLength(64);
    expect(accounts[0].validator.iconUrl).toBeNull();
  });

  test('an empty wallet makes no reward or validator reads', async () => {
    rpcWith(defaults({ getProgramAccounts: () => [] }));

    const { accounts } = await listStakeAccounts(WALLET, locals);

    expect(accounts).toEqual([]);
    expect(calls('getInflationReward')).toHaveLength(0);
    expect(calls('getVoteAccounts')).toHaveLength(0);
  });
});
