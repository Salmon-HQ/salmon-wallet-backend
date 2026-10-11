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
const bs58 = require('bs58').default || require('bs58');
const { getRpcUrl } = require('../../infrastructure/triton-client');
const { providerCall } = require('../../infrastructure/providers/provider-client');
const coingecko = require('../shared/coingecko-service');
const catalog = require('./token-catalog-service');
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
  totalShares: u128At(buf, 121),
  sharePrice: u128At(buf, 137),
});

/** `GuardianDelegationPool`: … commission_bps (u16) at 168, bump, active (bool) at 171. */
const decodeGuardianPool = (buf) => ({
  commissionBps: buf.readUInt16LE(168),
  active: buf[171] === 1,
});

// Anchor `emit_cpi`: the program calls itself with this tag, then the event's
// discriminator and fields (layouts from the on-chain IDL).
const EVENT_TAG = 'e445a52e51cb9a1d';
const SHARE_EVENTS = {
  '0b922dcde63ad5f0': { kind: 'staked', sign: 1n, shares: 184 }, // Staked.shares_minted
  '1bb39cd72f47c307': { kind: 'unstaked', sign: -1n, shares: 176 }, // Unstaked.shares_unstaked
  '66dfbd65c9dfb426': { kind: 'cancelled', sign: 1n, shares: 176 }, // UnstakeCancelled.shares_restored
};
// Offsets count from the start of the instruction data (tag + discriminator).
const EVENT_POSITION_OFFSET = 16;
const EVENT_USER_OFFSET = 16 + 96;

/**
 * A share-changing event from the program's event instruction: who, how many
 * shares (signed) and the share price at that instant. Null for anything else.
 *
 * @param {Buffer} data - the inner instruction's data.
 */
const decodeStakeEvent = (data) => {
  if (data.length < 16 || data.subarray(0, 8).toString('hex') !== EVENT_TAG) return null;
  const event = SHARE_EVENTS[data.subarray(8, 16).toString('hex')];
  if (!event || data.length < event.shares + 32) return null;
  return {
    kind: event.kind,
    position: pubkeyAt(data, EVENT_POSITION_OFFSET),
    user: pubkeyAt(data, EVENT_USER_OFFSET),
    sharesDelta: event.sign * u128At(data, event.shares),
    sharePrice: u128At(data, event.shares + 16),
  };
};

// The SKR inflation program's state: it mints each payout into the staking
// vault once per interval, counted from its start (fields matched against the
// payouts on chain: 02:00 UTC every 48 h since 2026-01-23).
const INFLATION_STATE = 'FMNn5sorEBbEoGQGrh7y3xSbYGt116F12FpL2VTsohiw';

/** When the last payout fell due and when the next one does, epoch ms. */
const payoutSchedule = (buf) => {
  const intervalSeconds = Number(buf.readBigInt64LE(29));
  const start = Number(buf.readBigInt64LE(37));
  const lastAt = (start + Number(buf.readBigUInt64LE(158)) * intervalSeconds) * 1000;
  return { intervalSeconds, lastAt, nextAt: lastAt + intervalSeconds * 1000 };
};

/** Staked and earned, in SKR base units. */
const positionValues = ({ shares, costBasis }, sharePrice) => ({
  staked: (shares * sharePrice) / SHARE_PRICE_SCALE,
  earned: (shares * (sharePrice - costBasis)) / SHARE_PRICE_SCALE,
});

/**
 * What a position's shares earned between daily records (each closing on a
 * payout), exact across stakes and unstakes (spec 022). Price points are the daily records and the owner's
 * staking events, which carry the share price of their instant. Walked from
 * the newest point back with the current shares, undoing each event's delta,
 * so every segment between two points is paid on the shares held during it,
 * and counted in the row of the record that closes it. Days without growth
 * are left out; nothing before the first record counts.
 *
 * @param {Array<{at: number, sharePrice: string}>} records
 * @param {Array<{at: number, sharesDelta: bigint, sharePrice: bigint}>} events
 * @param {bigint} currentShares
 * @returns {Array<{at: number, earned: bigint}>} newest first.
 */
const exactHistory = (records, events, currentShares) => {
  if (records.length === 0) return [];
  const since = Math.min(...records.map((r) => r.at));
  const points = [
    ...records.map((r) => ({ at: r.at, price: BigInt(r.sharePrice), delta: 0n, record: true })),
    ...events
      .filter((e) => e.at >= since)
      .map((e) => ({ at: e.at, price: e.sharePrice, delta: e.sharesDelta })),
  ].sort((a, b) => a.at - b.at);
  // Each segment belongs to the record that closes it: a row is one recorded
  // day. Points after the newest record (events since) belong to no day yet.
  const rows = new Map();
  let shares = currentShares;
  let closing = null;
  for (let i = points.length - 1; i > 0; i -= 1) {
    const end = points[i];
    if (end.record) closing = end.at;
    // Shares held up to an event are those before it.
    shares -= end.delta;
    if (closing === null) continue;
    const earned = (shares * (end.price - points[i - 1].price)) / SHARE_PRICE_SCALE;
    rows.set(closing, (rows.get(closing) ?? 0n) + earned);
  }
  return [...rows.entries()]
    .filter(([, earned]) => earned !== 0n)
    .map(([at, earned]) => ({ at, earned }))
    .sort((a, b) => b.at - a.at);
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

const storeSharePrice = (sharePrice, now, locals) =>
  storeInCache(
    dayKey(now, locals),
    { at: now, sharePrice: String(sharePrice) },
    RECORD_TTL_SECONDS
  );

/** Records today's share price unless today already has one; returns the last 30 days. */
const sharePriceRecords = async (sharePrice, now, locals) => {
  if (!(await getFromCache(dayKey(now, locals)))) await storeSharePrice(sharePrice, now, locals);
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

const TX_EVENTS_TTL_SECONDS = 400 * 24 * 60 * 60;
const SIGNATURE_PAGE = 1000;

/** The share-changing events of one confirmed transaction, cached for good. */
const transactionEvents = async (signature, owner, locals) => {
  const key = getCacheKeyFor('skr_tx_events', 'signature', signature, locals);
  const hit = await getFromCache(key);
  if (hit) return hit.events;
  const tx = await rpc(
    'getTransaction',
    [signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }],
    locals
  );
  const keys = [
    ...(tx?.transaction?.message?.accountKeys ?? []),
    ...(tx?.meta?.loadedAddresses?.writable ?? []),
    ...(tx?.meta?.loadedAddresses?.readonly ?? []),
  ];
  const events = [];
  for (const group of tx?.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      if (keys[ix.programIdIndex] !== STAKING_PROGRAM) continue;
      const event = decodeStakeEvent(Buffer.from(bs58.decode(ix.data)));
      if (event && event.user === owner) {
        events.push({
          at: tx.blockTime * 1000,
          position: event.position,
          sharesDelta: String(event.sharesDelta),
          sharePrice: String(event.sharePrice),
        });
      }
    }
  }
  if (tx) await storeInCache(key, { events }, TX_EVENTS_TTL_SECONDS);
  return events;
};

/**
 * The owner's share changes since `since` (epoch ms), oldest first, read from
 * its own transactions: its address is an account of every stake, unstake and
 * cancel. Failed transactions are skipped; each one is read once.
 */
const ownerEvents = async (owner, since, locals) => {
  const signatures = [];
  let before;
  for (;;) {
    const page = await rpc(
      'getSignaturesForAddress',
      [owner, { limit: SIGNATURE_PAGE, ...(before && { before }) }],
      locals
    );
    if (!page?.length) break;
    const recent = page.filter((x) => (x.blockTime ?? 0) * 1000 >= since);
    signatures.push(...recent.filter((x) => !x.err).map((x) => x.signature));
    if (recent.length < page.length || page.length < SIGNATURE_PAGE) break;
    before = page[page.length - 1].signature;
  }
  const events = [];
  for (const signature of signatures) {
    events.push(...(await transactionEvents(signature, owner, locals)));
  }
  return events
    .map((e) => ({
      at: e.at,
      position: e.position,
      sharesDelta: BigInt(e.sharesDelta),
      sharePrice: BigInt(e.sharePrice),
    }))
    .sort((a, b) => a.at - b.at);
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
 * Records today's share price, replacing a record a read made earlier in the
 * day: the daily job runs just after the 02:00 UTC payout, so each record
 * closes on a payout.
 */
const recordSharePrice = async (locals, now = Date.now()) => {
  const account = await rpc('getAccountInfo', [STAKE_CONFIG, { encoding: 'base64' }], locals);
  const { sharePrice } = decodeStakeConfig(accountData(account.value));
  await storeSharePrice(sharePrice, now, locals);
  return sharePrice;
};

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
    [[STAKE_CONFIG, INFLATION_STATE, ...pools], { encoding: 'base64' }],
    locals
  );
  const config = decodeStakeConfig(accountData(accounts.value[0]));
  const poolByAddress = new Map(
    pools.map((address, i) => {
      const account = accounts.value[i + 2];
      return [address, account ? decodeGuardianPool(accountData(account)) : null];
    })
  );
  const [records, usdPrice, liquid, logo] = await Promise.all([
    sharePriceRecords(config.sharePrice, now, locals),
    usdPriceOf(SKR_MINT, locals),
    liquidSkr(owner, locals),
    // The wallet's own list has no SKR when all of it is staked.
    catalog.logoOf(SKR_MINT),
  ]);
  const historySince = records.length > 0 ? Math.min(...records.map((r) => r.at)) : null;
  // One record has no growth to report: skip reading the owner's transactions.
  // Without them the history is left out (empty) rather than inexact.
  let events = [];
  if (records.length > 1 && positions.length > 0) {
    events = await ownerEvents(owner, historySince, locals).catch((error) => {
      console.warn(`[SKR_HISTORY] owner events unreadable: ${error.message}`);
      return null;
    });
  }

  return {
    mint: SKR_MINT,
    sharePrice: config.sharePrice,
    cooldownSeconds: config.cooldownSeconds,
    // Everything staked in the program, every holder's shares at today's price.
    totalStaked: (config.totalShares * config.sharePrice) / SHARE_PRICE_SCALE,
    apy: apyFrom(records),
    usdPrice,
    liquid,
    logo,
    payouts: accounts.value[1] ? payoutSchedule(accountData(accounts.value[1])) : null,
    // Rewards are listed from the first day the share price was recorded.
    historySince,
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
          history:
            events === null
              ? []
              : exactHistory(
                  records,
                  events.filter((e) => e.position === position.address),
                  position.shares
                ),
        };
      })
    ),
  };
};

module.exports = {
  getSkrStake,
  recordSharePrice,
  payoutSchedule,
  decodeUserStake,
  decodeStakeConfig,
  decodeGuardianPool,
  positionValues,
  exactHistory,
  decodeStakeEvent,
  ownerEvents,
  apyFrom,
  SKR_MINT,
};
