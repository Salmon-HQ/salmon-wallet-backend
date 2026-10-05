'use strict';

/**
 * One row per upstream provider: rate budget, timeout, retry policy and
 * circuit-breaker thresholds. Adding a provider is adding a row; the
 * plumbing in `provider-client.js` reads nothing else.
 *
 * `<PROVIDER>_MAX_RPS` (e.g. `TRITON_MAX_RPS`) overrides the sustained rate
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

const PROFILES = {
  coingecko: {
    tier: coingeckoTier,
    timeoutMs: 15000,
    retry: { maxAttempts: 6, baseMs: 2000, maxMs: 60000, honorRetryAfter: true },
    breaker: BREAKER_DEFAULT,
  },
  triton: {
    tier: () => ({ rps: 50, burst: 100 }),
    timeoutMs: 30000,
    retry: { maxAttempts: 2, baseMs: 500, maxMs: 2000, honorRetryAfter: true },
    breaker: BREAKER_DEFAULT,
  },
  // Bitcoin (Esplora). No retry: `esplora-client` moves to the other host
  // instead. Neither public host publishes a rate; 10 rps stays well under
  // what they serve anonymous clients. 10 s: a busy address's history page
  // has been measured at ~6.5 s on mempool.space.
  mempool: {
    tier: () => ({ rps: 10, burst: 20 }),
    timeoutMs: 10000,
    retry: RETRY_NONE,
    breaker: BREAKER_DEFAULT,
  },
  blockstream: {
    tier: () => ({ rps: 10, burst: 20 }),
    timeoutMs: 10000,
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
  // TRM Labs sanctions screening: 60/min without a key. No retry — the
  // sanctions service falls back to the local SDN copy.
  trm: {
    tier: () => ({ rps: 1, burst: 5 }),
    timeoutMs: 5000,
    retry: RETRY_NONE,
    breaker: BREAKER_DEFAULT,
  },
  // Jupiter Swap API, Developer plan (10 rps).
  jupiter: {
    tier: () => ({ rps: 10, burst: 10 }),
    timeoutMs: 10000,
    retry: { maxAttempts: 3, baseMs: 500, maxMs: 5000, honorRetryAfter: true },
    breaker: BREAKER_DEFAULT,
  },
  // 0x Swap API, Standard plan (5 rps).
  zeroex: {
    tier: () => ({ rps: 5, burst: 5 }),
    timeoutMs: 10000,
    retry: { maxAttempts: 3, baseMs: 500, maxMs: 5000, honorRetryAfter: true },
    breaker: BREAKER_DEFAULT,
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
