'use strict';

/**
 * UI-amount multipliers for Token-2022 mints.
 *
 * Two mint extensions make the displayed amount differ from the stored one:
 *
 *   - **Scaled UI Amount** — an updatable `multiplier` (rebasing tokens, stock
 *     splits). `newMultiplier` replaces it at `newMultiplierEffectiveTimestamp`.
 *   - **Interest Bearing** — an annual rate that compounds continuously, so the
 *     displayed amount grows while the stored one does not.
 *
 * The Token Extension Program rejects both on one mint, so a mint has at most
 * one multiplier. Neither extension mints or moves tokens: `amount` stays the
 * unit every transfer, fee and price calculation is denominated in, and the
 * multiplier is display-only. That split is the whole point — Solana's own
 * integration guide says to keep raw amounts for calculations and convert
 * "at the edge", which for us is `account-balance-resource`.
 *
 * Neither balance provider reports the multiplier: Blockdaemon Universal
 * returns `confirmed_balance` + `decimals` and nothing else, and the bare-RPC
 * provider's `uiAmount` would only cover the fallback path. So the multiplier
 * is resolved here from the mint account itself and applied the same way
 * whichever provider answered.
 *
 * Only Token-2022 mints can carry either extension, so callers narrow the list
 * by the catalog's `tokenProgram` first — a wallet holding only classic SPL
 * tokens makes no request at all.
 */

const axios = require('axios');
const { getRpcUrl } = require('../../infrastructure/triton-client');
const {
  getCacheKeyFor,
  getManyFromCache,
  storeManyInCache,
} = require('../../infrastructure/cache/cache-helper');
const { providerCall } = require('../../infrastructure/providers/provider-client');

/** `getMultipleAccounts` caps at 100 addresses per call. */
const MAX_MINTS_PER_BATCH = 100;
const REQUEST_TIMEOUT = 10000;

/**
 * The extension config, not the multiplier it currently implies: both
 * extensions derive that from the clock, so the effective value is recomputed
 * per request and only an issuer instruction invalidates what is cached.
 */
const CACHE_TTL_SECONDS = 5 * 60;

/** Fixed-point scale for multiplier arithmetic — wide enough for f64 mantissa. */
const SCALE_DECIMALS = 18;
const SCALE = 10n ** BigInt(SCALE_DECIMALS);

/** `interest_bearing_mint`: rates are basis points over a 365.24-day year. */
const ONE_IN_BASIS_POINTS = 10000;
const SECONDS_PER_YEAR = 60 * 60 * 24 * 365.24;

/**
 * Parse a decimal string into the fixed-point integer used for multiplication.
 * Avoids float entirely: a raw balance can exceed 2^53 and `Number` would
 * silently round it before the multiplier ever applied.
 *
 * @param {string|number} value
 * @returns {bigint|null} `value * 10^SCALE_DECIMALS`, or null when unparseable.
 */
const toFixedPoint = (value) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    value = value.toFixed(SCALE_DECIMALS);
  }
  if (typeof value !== 'string') return null;
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  if (whole === '' && fraction === '') return null;
  const padded = fraction.padEnd(SCALE_DECIMALS, '0').slice(0, SCALE_DECIMALS);
  const magnitude = BigInt(whole || '0') * SCALE + BigInt(padded || '0');
  return sign === '-' ? -magnitude : magnitude;
};

/**
 * The multiplier a Scaled UI Amount mint applies right now. `newMultiplier`
 * takes over at `newMultiplierEffectiveTimestamp`; strictly before it, and
 * when no timestamp is set at all, `multiplier` still stands.
 */
const scaledUiMultiplier = (state, nowSeconds) => {
  if (!state) return null;

  // Matches `amount_to_ui_amount` in the Token Extension Program, which
  // compares against the timestamp and nothing else: 0 and any elapsed
  // negative value mean "already effective", not "unset". An absent
  // timestamp is the only "nothing scheduled" case, and it is handled here
  // rather than folded into the numeric comparison.
  const raw = state.newMultiplierEffectiveTimestamp;
  const effectiveAt = raw === undefined || raw === null ? null : Number(raw);
  const active =
    effectiveAt !== null && Number.isFinite(effectiveAt) && nowSeconds >= effectiveAt
      ? state.newMultiplier
      : state.multiplier;

  return toFixedPoint(active ?? state.multiplier);
};

/**
 * The multiplier an Interest Bearing mint implies right now: interest accrued
 * under the historical average rate up to `lastUpdateTimestamp`, then under
 * `currentRate` since. Mirrors `amount_to_ui_amount` in the Token Extension
 * Program (`interest_bearing_mint`), which is itself f64 — matching it matters
 * more than being independently precise.
 */
const interestBearingMultiplier = (state, nowSeconds) => {
  if (!state) return null;
  const initializedAt = Number(state.initializationTimestamp ?? 0);
  const lastUpdatedAt = Number(state.lastUpdateTimestamp ?? 0);
  const preUpdateRate = Number(state.preUpdateAverageRate ?? 0);
  const currentRate = Number(state.currentRate ?? 0);
  if (![initializedAt, lastUpdatedAt, preUpdateRate, currentRate].every(Number.isFinite)) {
    return null;
  }

  const preUpdate = Math.exp(
    (preUpdateRate * (lastUpdatedAt - initializedAt)) / SECONDS_PER_YEAR / ONE_IN_BASIS_POINTS
  );
  const postUpdate = Math.exp(
    (currentRate * (nowSeconds - lastUpdatedAt)) / SECONDS_PER_YEAR / ONE_IN_BASIS_POINTS
  );
  const multiplier = preUpdate * postUpdate;
  return Number.isFinite(multiplier) ? toFixedPoint(multiplier) : null;
};

/**
 * Reduce a parsed mint account to the multiplier its extensions imply, or null
 * when it carries neither (the overwhelming majority of mints).
 */
const readMultiplier = (parsedMint, nowSeconds) => {
  const extensions = parsedMint?.data?.parsed?.info?.extensions;
  if (!Array.isArray(extensions)) return null;
  for (const entry of extensions) {
    if (entry?.extension === 'scaledUiAmountConfig') {
      return scaledUiMultiplier(entry.state, nowSeconds);
    }
    if (entry?.extension === 'interestBearingConfig') {
      return interestBearingMultiplier(entry.state, nowSeconds);
    }
  }
  return null;
};

const fetchMintBatch = async (mints, environment, locals) => {
  const { data } = await providerCall(
    'triton',
    ({ timeout, signal }) =>
      axios.post(
        getRpcUrl(environment),
        {
          jsonrpc: '2.0',
          id: 'token-ui-amount',
          method: 'getMultipleAccounts',
          params: [mints, { encoding: 'jsonParsed', commitment: 'confirmed' }],
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: Math.min(REQUEST_TIMEOUT, timeout),
          signal,
        }
      ),
    { locals, environment, operationName: 'Solana getMultipleAccounts (mint extensions)' }
  );
  if (data?.error) {
    throw new Error(
      `getMultipleAccounts failed: ${data.error.message || JSON.stringify(data.error)}`
    );
  }
  return Array.isArray(data?.result?.value) ? data.result.value : [];
};

const cacheKey = (mint, locals) => getCacheKeyFor('token_ui_extensions', 'mint', mint, locals);

/**
 * The extension config each mint carries, `null` for mints with neither. Cached
 * per mint so a wallet's repeat balance reads cost nothing.
 *
 * @param {string[]} mints - Token-2022 mints only; callers narrow the list.
 * @param {Object} [locals] - reads `network.environment`.
 * @returns {Promise<Map<string, Array<Object>|null>>} mint → extensions array.
 */
const getMintExtensions = async (mints, locals = {}) => {
  const wanted = [...new Set(mints)].filter(Boolean);
  const result = new Map();
  if (wanted.length === 0) return result;

  const cached = await getManyFromCache(wanted.map((mint) => cacheKey(mint, locals)));
  const misses = [];
  for (const mint of wanted) {
    const hit = cached.get(cacheKey(mint, locals));
    if (hit === undefined || hit === null) {
      misses.push(mint);
    } else {
      result.set(mint, hit.extensions ?? null);
    }
  }

  const environment = locals?.network?.environment || 'mainnet';
  for (let i = 0; i < misses.length; i += MAX_MINTS_PER_BATCH) {
    const slice = misses.slice(i, i + MAX_MINTS_PER_BATCH);
    const accounts = await fetchMintBatch(slice, environment, locals);
    const fresh = [];
    slice.forEach((mint, index) => {
      const extensions = accounts[index]?.data?.parsed?.info?.extensions ?? null;
      result.set(mint, extensions);
      fresh.push([cacheKey(mint, locals), { extensions }]);
    });
    await storeManyInCache(fresh, CACHE_TTL_SECONDS);
  }

  return result;
};

/**
 * Apply a fixed-point multiplier to a raw balance and render the UI amount the
 * user should see, truncated to the mint's decimals as Solana's integration
 * guide prescribes.
 *
 * @param {string|bigint} rawAmount - balance in base units.
 * @param {number} decimals
 * @param {bigint} multiplier - fixed point, `10^SCALE_DECIMALS` scale.
 * @returns {string|null} decimal string, or null when the inputs are unusable.
 */
const renderUiAmount = (rawAmount, decimals, multiplier) => {
  if (typeof multiplier !== 'bigint' || multiplier <= 0n) return null;
  if (!Number.isInteger(decimals) || decimals < 0) return null;
  let raw;
  try {
    raw = BigInt(rawAmount);
  } catch {
    return null;
  }

  // Truncate toward zero at `decimals` places: scaled base units, then a plain
  // integer-division split so no float ever touches the balance.
  const scaledBaseUnits = (raw * multiplier) / SCALE;
  const divisor = 10n ** BigInt(decimals);
  const whole = scaledBaseUnits / divisor;
  const fraction = scaledBaseUnits % divisor;
  if (decimals === 0) return whole.toString();
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
};

/**
 * The UI amount for each mint whose extensions make it differ from
 * `amount / 10^decimals`. Mints that scale 1:1 are absent from the result, so
 * callers leave the ordinary case untouched.
 *
 * @param {Array<{mint: string, amount: string|bigint, decimals: number}>} holdings
 * @param {Object} [locals]
 * @returns {Promise<Map<string, string>>} mint → UI amount decimal string.
 */
const getUiAmounts = async (holdings, locals = {}) => {
  const uiAmounts = new Map();
  if (!Array.isArray(holdings) || holdings.length === 0) return uiAmounts;

  const extensionsByMint = await getMintExtensions(
    holdings.map((holding) => holding.mint),
    locals
  );
  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const { mint, amount, decimals } of holdings) {
    const extensions = extensionsByMint.get(mint);
    if (!extensions) continue;
    const multiplier = readMultiplier({ data: { parsed: { info: { extensions } } } }, nowSeconds);
    if (multiplier === null || multiplier === SCALE) continue;
    const uiAmount = renderUiAmount(amount, decimals, multiplier);
    if (uiAmount !== null) uiAmounts.set(mint, uiAmount);
  }

  return uiAmounts;
};

module.exports = {
  getUiAmounts,
  getMintExtensions,
  renderUiAmount,
  readMultiplier,
  toFixedPoint,
  SCALE,
  SCALE_DECIMALS,
  MAX_MINTS_PER_BATCH,
};
