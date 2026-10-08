'use strict';

jest.mock('axios');
jest.mock('../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((_name, run) => run({ timeout: 10000, signal: undefined })),
}));
jest.mock('../../../infrastructure/cache/cache-helper', () => {
  const store = new Map();
  return {
    __store: store,
    getCacheKeyFor: (entity, property, value) => `${entity}:${property}:${value}`,
    getFromCache: jest.fn(async (key) => store.get(key) ?? null),
    getManyFromCache: jest.fn(async (keys) => new Map(keys.map((k) => [k, store.get(k) ?? null]))),
    storeInCache: jest.fn(async (key, value) => store.set(key, value)),
  };
});

jest.mock('../../shared/coingecko-service', () => ({ getTokenPrices: jest.fn() }));

const axios = require('axios');
const coingecko = require('../../shared/coingecko-service');
const cache = require('../../../infrastructure/cache/cache-helper');
const { getSkrStake } = require('../skr-staking-service');

const OWNER = 'CzNRNm6vbDiJ2MG96Lw4gSZW1gSjeV6DgSEAjCULxXcJ';
const POSITION = '7yFnVkeEk4Qd6jgGsjrU4rhYDd7UQ985ah1VgWNg8m58';
const locals = { network: { environment: 'mainnet', id: 'solana-mainnet' } };
const NOW = Date.parse('2026-10-08T21:00:00Z');

// Recorded on mainnet (see skr-staking-pure.spec.js).
const USER_STAKE =
  'ZjWjawmKV5n+MMd0OFYtRe9beSkvYc8PNRQ1nYzgszbll2atCImxvN6yIuHcuiojh5VFAnTHMZqEqeXH+9oVh5p2yLbnjozFn7gCUtGNtSuONRWJvQL7jRyzJlcF9a4LANKbp5jhwl3hAJAvUAkAAAAAAAAAAAAAAADKmjsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
const STAKE_CONFIG =
  '7pcrAwuXP7D/99/RmBWIoUKnBCJppz3tD3Kiqm19wGlNrfxqo58KnyMGfFo+Bf5BRxKnour+Qr52ELzZDL9XFid1g3PLitDYpHK7t3HxKVTi9/Qhl74s+E4dlydE1728RBtKSZ5/fy2TQEIPAAAAAAAAowIAAAAAAAxIb2O1gw8AAAAAAAAAAAAWC51EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACa+OAN8PIRAA==';
const GUARDIAN_POOL =
  'he7/1tcLvRcwx3Q4Vi1F71t5KS9hzw81FDWdjOCzNuWXZq0IibG83gZ8WJTOnorbS50M0/6yYuuZboUVKKTmfwK8/8Gr9hNs99/RmBWIoUKnBCJppz3tD3Kiqm19wGlNrfxqo58KnyMMSG9jtYMPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYLnUQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AQAAAAAAAAAAAAAAAAAAAAA=';

/** The recorded position with an unstake of 5 SKR requested at `ts`. */
const unstakingPosition = (ts) => {
  const buf = Buffer.from(USER_STAKE, 'base64');
  buf.writeBigUInt64LE(5000000n, 153);
  buf.writeBigInt64LE(BigInt(ts), 161);
  return buf.toString('base64');
};

const rpcWith = ({ stakeData = USER_STAKE, positions = 1, signatures = [] } = {}) => {
  axios.post.mockImplementation(async (_url, body) => {
    const result = {
      getProgramAccounts: Array.from({ length: positions }, () => ({
        pubkey: POSITION,
        account: { data: [stakeData, 'base64'] },
      })),
      getMultipleAccounts: {
        value: [{ data: [STAKE_CONFIG, 'base64'] }, { data: [GUARDIAN_POOL, 'base64'] }],
      },
      getSignaturesForAddress: signatures,
      getTokenAccountsByOwner: {
        value: [
          { account: { data: { parsed: { info: { tokenAmount: { amount: '2500000' } } } } } },
          { account: { data: { parsed: { info: { tokenAmount: { amount: '500000' } } } } } },
        ],
      },
    }[body.method];
    return { data: { result } };
  });
};
const calls = (method) => axios.post.mock.calls.filter(([, body]) => body.method === method);

beforeEach(() => {
  jest.clearAllMocks();
  cache.__store.clear();
  coingecko.getTokenPrices.mockResolvedValue(
    new Map([
      ['SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3', { usdPrice: 0.01622, priceChange24h: 1.2 }],
    ])
  );
  process.env.TRITON_RPC_URL = 'https://triton.example/token';
});

test("reads the owner's position with its guardian", async () => {
  rpcWith();

  const result = await getSkrStake(OWNER, locals, NOW);

  expect(result).toMatchObject({
    mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
    sharePrice: 1151142678n,
    cooldownSeconds: 172800,
    apy: null,
    usdPrice: 0.01622,
    liquid: 3000000n,
  });
  const [owner, filter] = calls('getTokenAccountsByOwner')[0][1].params;
  expect(owner).toBe(OWNER);
  expect(filter).toEqual({ mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3' });
  expect(result.positions).toEqual([
    {
      address: POSITION,
      staked: 46045707120n,
      earned: 6045707120n,
      guardian: {
        pool: 'DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr',
        name: 'Solana Mobile Guardian',
        commissionBps: 0,
        active: true,
      },
      unstaking: null,
      stakedSince: null,
      history: [],
    },
  ]);
  const [, filters] = calls('getProgramAccounts')[0][1].params;
  expect(filters.filters).toEqual([{ dataSize: 169 }, { memcmp: { offset: 41, bytes: OWNER } }]);
});

test('records the share price once a day, and lists what the shares earned since the last record', async () => {
  cache.__store.set('skr_share_price:day:2026-10-07', {
    at: Date.parse('2026-10-07T09:00:00Z'),
    sharePrice: '1150500000',
  });
  rpcWith();

  const first = await getSkrStake(OWNER, locals, NOW);
  await getSkrStake(OWNER, locals, NOW + 60000);

  expect(cache.__store.get('skr_share_price:day:2026-10-08')).toEqual({
    at: NOW,
    sharePrice: '1151142678',
  });
  expect(
    cache.storeInCache.mock.calls.filter(([key]) => key.startsWith('skr_share_price'))
  ).toHaveLength(1);
  expect(first.positions[0].history).toEqual([{ at: NOW, earned: 25707120n }]);
});

test('says how much is unstaking and when it can be withdrawn', async () => {
  const requested = Math.floor(NOW / 1000) - 3600;
  rpcWith({ stakeData: unstakingPosition(requested) });

  const { positions } = await getSkrStake(OWNER, locals, NOW);

  expect(positions[0].unstaking).toEqual({
    amount: 5000000n,
    withdrawableAt: (requested + 172800) * 1000,
  });
});

test('dates the stake from its oldest indexed transaction, and caches it', async () => {
  rpcWith({
    signatures: [
      { signature: 'b', blockTime: 1790000000 },
      { signature: 'a', blockTime: 1768977867 },
    ],
  });

  const first = await getSkrStake(OWNER, locals, NOW);
  axios.post.mockClear();
  await getSkrStake(OWNER, locals, NOW);

  expect(first.positions[0].stakedSince).toBe(1768977867000);
  expect(calls('getSignaturesForAddress')).toHaveLength(0);
});

test('a wallet without positions answers the global figures and no positions', async () => {
  rpcWith({ positions: 0 });

  const result = await getSkrStake(OWNER, locals, NOW);

  expect(result.positions).toEqual([]);
  expect(result.sharePrice).toBe(1151142678n);
});

test('answers without a price when the price lookup fails', async () => {
  coingecko.getTokenPrices.mockRejectedValue(new Error('429'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  rpcWith();

  const result = await getSkrStake(OWNER, locals, NOW);

  expect(result.usdPrice).toBeNull();
  expect(result.positions).toHaveLength(1);
  warn.mockRestore();
});
