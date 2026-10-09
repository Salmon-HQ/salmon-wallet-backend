'use strict';

/**
 * A wallet's SKR staking position (spec 021).
 *
 * SKR is staked with a guardian through Solana Mobile's staking program. A
 * position holds `shares`; it is worth `shares × share_price / 10^9` SKR, and
 * the share price rises every 48-hour epoch, so rewards compound without a
 * claim. `cost_basis` is the share price the shares were bought at, which
 * makes the earned total exact without any history.
 *
 * The per-period history is not on chain in any form cheap to read (the
 * program moves thousands of transactions an hour), so each request records
 * the day's share price once and the history is the difference between
 * consecutive records. Read-only: no stake transaction is built.
 *
 * Account layouts come from the program's Anchor IDL published on chain;
 * offsets below count from the start of the account, after the 8-byte
 * discriminator.
 */

const axios = require('axios');
const { PublicKey } = require('@solana/web3.js');
const { getRpcUrl } = require('../../infrastructure/triton-client');
const { providerCall } = require('../../infrastructure/providers/provider-client');
const coingecko = require('../shared/coingecko-service');
const {
  getCacheKeyFor,
  getFromCache,
  getManyFromCache,
  storeInCache,
} = require('../../infrastructure/cache/cache-helper');

const STAKING_PROGRAM = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
const STAKE_CONFIG = '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw';
const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const SHARE_PRICE_SCALE = 10n ** 9n;
const USER_STAKE_SIZE = 169;
const USER_OFFSET = 41;

// Guardian pools carry no name on chain; the names Solana Mobile documents.
const KNOWN_GUARDIANS = {
  DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr: 'Solana Mobile Guardian',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 30;
const RECORD_TTL_SECONDS = 400 * 24 * 60 * 60;
const STAKED_SINCE_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_APY_SPAN_MS = 7 * DAY_MS;
const YEAR_MS = 365.25 * DAY_MS;
const REQUEST_TIMEOUT = 10000;

const pubkeyAt = (buf, offset) => new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
const u128At = (buf, offset) =>
  buf.readBigUInt64LE(offset) + (buf.readBigUInt64LE(offset + 8) << 64n);

/** `UserStake`: bump, stake_config, user, guardian_pool, shares, cost_basis, … */
const decodeUserStake = (buf) => ({
  stakeConfig: pubkeyAt(buf, 9),
  user: pubkeyAt(buf, 41),
  guardianPool: pubkeyAt(buf, 73),
  shares: u128At(buf, 105),
  costBasis: u128At(buf, 121),
  unstakingAmount: buf.readBigUInt64LE(153),
  unstakeTimestamp: Number(buf.readBigInt64LE(161)),
});

/** `StakeConfig`: bump, authority, mint, stake_vault, min_stake, cooldown, total_shares, share_price, … */
const decodeStakeConfig = (buf) => ({
  mint: pubkeyAt(buf, 41),
  cooldownSeconds: Number(buf.readBigUInt64LE(113)),
  sharePrice: u128At(buf, 137),
});

/** `GuardianDelegationPool`: … commission_bps (u16) at 168, bump, active (bool) at 171. */
const decodeGuardianPool = (buf) => ({
  commissionBps: buf.readUInt16LE(168),
  active: buf[171] === 1,
});

/** Staked and earned, in SKR base units. */
const positionValues = ({ shares, costBasis }, sharePrice) => ({
  staked: (shares * sharePrice) / SHARE_PRICE_SCALE,
  earned: (shares * (sharePrice - costBasis)) / SHARE_PRICE_SCALE,
});

/**
 * What `shares` earned between consecutive records, newest first. Records
 * before `since` (when the stake began) are ignored.
 */
const historyFrom = (records, shares, since) => {
  const sorted = records.filter((r) => since === null || r.at >= since).sort((a, b) => a.at - b.at);
  const history = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const growth = BigInt(sorted[i].sharePrice) - BigInt(sorted[i - 1].sharePrice);
    history.push({ at: sorted[i].at, earned: (shares * growth) / SHARE_PRICE_SCALE });
  }
  return history.reverse();
};

/** Annualized share-price growth over the widest span of records, if ≥ 7 days. */
const apyFrom = (records) => {
  if (records.length < 2) return null;
  const sorted = [...records].sort((a, b) => a.at - b.at);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last.at - first.at;
  if (span < MIN_APY_SPAN_MS) return null;
  const growth = Number(last.sharePrice) / Number(first.sharePrice);
  return growth ** (YEAR_MS / span) - 1;
};

const rpc = async (method, params, locals) => {
  const environment = locals?.network?.environment || 'mainnet';
  const { data } = await providerCall(
    'triton',
    ({ timeout, signal }) =>
      axios.post(
        getRpcUrl(environment),
        { jsonrpc: '2.0', id: `skr-${method}`, method, params },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: Math.min(REQUEST_TIMEOUT, timeout),
          signal,
        }
      ),
    { locals, environment, operationName: `Solana ${method} (SKR staking)` }
  );
  if (data?.error) {
    throw new Error(`${method} failed: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return data?.result;
};

const dayKey = (at, locals) =>
  getCacheKeyFor('skr_share_price', 'day', new Date(at).toISOString().slice(0, 10), locals);

/** Records today's share price unless today already has one; returns the last 30 days. */
const sharePriceRecords = async (sharePrice, now, locals) => {
  const today = dayKey(now, locals);
  if (!(await getFromCache(today))) {
    await storeInCache(today, { at: now, sharePrice: String(sharePrice) }, RECORD_TTL_SECONDS);
  }
  const keys = Array.from({ length: HISTORY_DAYS }, (_, i) => dayKey(now - i * DAY_MS, locals));
  const found = await getManyFromCache(keys);
  return keys.map((key) => found.get(key)).filter(Boolean);
};

/** The owner's SKR outside staking, in base units: the sum of its SKR token accounts. */
const liquidSkr = async (owner, locals) => {
  const accounts = await rpc(
    'getTokenAccountsByOwner',
    [owner, { mint: SKR_MINT }, { encoding: 'jsonParsed' }],
    locals
  );
  return (accounts?.value ?? []).reduce(
    (sum, { account }) => sum + BigInt(account.data.parsed.info.tokenAmount.amount),
    0n
  );
};

/** When the position's oldest indexed transaction ran, or null. */
const stakedSince = async (address, locals) => {
  const key = getCacheKeyFor('skr_staked_since', 'position', address, locals);
  const hit = await getFromCache(key);
  if (hit) return hit.at;
  let oldest = null;
  let before;
  for (;;) {
    const page = await rpc(
      'getSignaturesForAddress',
      [address, { limit: 1000, ...(before && { before }) }],
      locals
    );
    if (!page?.length) break;
    oldest = page[page.length - 1];
    if (page.length < 1000) break;
    before = oldest.signature;
  }
  const at = oldest?.blockTime ? oldest.blockTime * 1000 : null;
  // Nothing indexed is not cached: the provider may index it later.
  if (at !== null) await storeInCache(key, { at }, STAKED_SINCE_TTL_SECONDS);
  return at;
};

/** USD price of `mint`, or null: a missing price never fails the read. */
const usdPriceOf = async (mint, locals) => {
  try {
    return (await coingecko.getTokenPrices([mint], locals)).get(mint)?.usdPrice ?? null;
  } catch (error) {
    console.warn(`[STAKING_PRICE] no price for ${mint}: ${error.message}`);
    return null;
  }
};

const accountData = (account) => Buffer.from(account.data[0], 'base64');

/**
 * @param {string} owner - wallet.
 * @param {Object} locals - Express `res.locals`.
 * @param {number} [now] - injectable clock.
 */
const getSkrStake = async (owner, locals, now = Date.now()) => {
  const stakes = await rpc(
    'getProgramAccounts',
    [
      STAKING_PROGRAM,
      {
        encoding: 'base64',
        filters: [{ dataSize: USER_STAKE_SIZE }, { memcmp: { offset: USER_OFFSET, bytes: owner } }],
      },
    ],
    locals
  );
  const positions = (stakes ?? []).map(({ pubkey, account }) => ({
    address: pubkey,
    ...decodeUserStake(accountData(account)),
  }));
  const pools = [...new Set(positions.map((p) => p.guardianPool))];
  const accounts = await rpc(
    'getMultipleAccounts',
    [[STAKE_CONFIG, ...pools], { encoding: 'base64' }],
    locals
  );
  const config = decodeStakeConfig(accountData(accounts.value[0]));
  const poolByAddress = new Map(
    pools.map((address, i) => {
      const account = accounts.value[i + 1];
      return [address, account ? decodeGuardianPool(accountData(account)) : null];
    })
  );
  const [records, usdPrice, liquid] = await Promise.all([
    sharePriceRecords(config.sharePrice, now, locals),
    usdPriceOf(SKR_MINT, locals),
    liquidSkr(owner, locals),
  ]);

  return {
    mint: SKR_MINT,
    sharePrice: config.sharePrice,
    cooldownSeconds: config.cooldownSeconds,
    apy: apyFrom(records),
    usdPrice,
    liquid,
    positions: await Promise.all(
      positions.map(async (position) => {
        const since = await stakedSince(position.address, locals);
        const pool = poolByAddress.get(position.guardianPool);
        return {
          address: position.address,
          ...positionValues(position, config.sharePrice),
          guardian: {
            pool: position.guardianPool,
            name: KNOWN_GUARDIANS[position.guardianPool] ?? null,
            commissionBps: pool?.commissionBps ?? null,
            active: pool?.active ?? null,
          },
          unstaking:
            position.unstakingAmount > 0n
              ? {
                  amount: position.unstakingAmount,
                  withdrawableAt: (position.unstakeTimestamp + config.cooldownSeconds) * 1000,
                }
              : null,
          stakedSince: since,
          history: historyFrom(records, position.shares, since),
        };
      })
    ),
  };
};

module.exports = {
  getSkrStake,
  decodeUserStake,
  decodeStakeConfig,
  decodeGuardianPool,
  positionValues,
  historyFrom,
  apyFrom,
  SKR_MINT,
};
