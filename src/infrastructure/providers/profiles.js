'use strict';

/**
 * One row per upstream provider: rate budget, timeout, retry policy and
 * circuit-breaker thresholds. Adding a provider is adding a row; the
 * plumbing in `provider-client.js` reads nothing else.
 *
 * `<PROVIDER>_MAX_RPS` (e.g. `ZEROEX_MAX_RPS`) overrides the sustained rate
 * at runtime; burst never drops below the rate so one second of traffic
 * always fits.
 */

const RETRY_NONE = { maxAttempts: 1, baseMs: 0, maxMs: 0, honorRetryAfter: false };
const BREAKER_DEFAULT = { failures: 5, cooldownMs: 30000 };

// A Demo key still runs on the public host at 30 req/min; only a paid plan
// (pro-api host) gets the paid budget.
const coingeckoTier = () =>
  process.env.COINGECKO_API_KEY && (process.env.COINGECKO_API_URL || '').includes('pro-api')
    ? { rps: 500 / 60, burst: 100 }
    : { rps: 25 / 60, burst: 30 };

const heliusTier = () =>
  process.env.HELIUS_TIER === 'paid' ? { rps: 50, burst: 100 } : { rps: 10, burst: 20 };

const PROFILES = {
  coingecko: {
    tier: coingeckoTier,
    timeoutMs: 15000,
    retry: { maxAttempts: 6, baseMs: 2000, maxMs: 60000, honorRetryAfter: true },
    breaker: BREAKER_DEFAULT,
  },
  helius: {
    tier: heliusTier,
    timeoutMs: 30000,
    retry: { maxAttempts: 4, baseMs: 1000, maxMs: 15000, honorRetryAfter: true },
    breaker: BREAKER_DEFAULT,
  },
  triton: {
    tier: () => ({ rps: 50, burst: 100 }),
    timeoutMs: 30000,
    retry: { maxAttempts: 2, baseMs: 500, maxMs: 2000, honorRetryAfter: true },
    breaker: BREAKER_DEFAULT,
  },
  // Free tier documents ~5 rps but a live probe (2026-09-10) got 429 on the
  // 3rd call within ~2 s, so the default stays well under that.
  zeroex: {
    tier: () => ({ rps: 2, burst: 2 }),
    timeoutMs: 10000,
    retry: { maxAttempts: 3, baseMs: 500, maxMs: 4000, honorRetryAfter: true },
    breaker: BREAKER_DEFAULT,
  },
  // No retry: the balance service falls back to the bare RPC on failure.
  blockdaemon: {
    tier: () => ({ rps: 20, burst: 40 }),
    timeoutMs: 6000,
    retry: RETRY_NONE,
    breaker: BREAKER_DEFAULT,
  },
  // Every dapp is a different host, so a breaker would let one broken dapp
  // hide every other one; the fetch is already SSRF-guarded and bounded.
  dapp: {
    tier: () => ({ rps: 10, burst: 20 }),
    timeoutMs: 5000,
    retry: RETRY_NONE,
    breaker: null,
  },
};

/**
 * @param {string} name - a key of `PROFILES`.
 * @returns {{ name: string, rps: number, burst: number, timeoutMs: number, retry: Object, breaker: Object|null }}
 */
const getProfile = (name) => {
  const profile = PROFILES[name];
  if (!profile) throw new Error(`Unknown provider profile: ${name}`);
  const tier = profile.tier();
  const override = Number(process.env[`${name.toUpperCase()}_MAX_RPS`]);
  const rps = override > 0 ? override : tier.rps;
  const burst = override > 0 ? Math.max(Math.ceil(override), tier.burst) : tier.burst;
  return {
    name,
    rps,
    burst,
    timeoutMs: profile.timeoutMs,
    retry: profile.retry,
    breaker: profile.breaker,
  };
};

module.exports = { getProfile, PROVIDER_NAMES: Object.keys(PROFILES) };
