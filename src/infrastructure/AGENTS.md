# AGENTS.md instructions for `src/infrastructure`

## Responsibility

- shared technical clients and reusable plumbing for external providers
  / infrastructure concerns
- code that is purely technical (HTTP construction, rate limiting,
  caching primitives) and not part of any business domain

## Current contents

- `blockdaemon-client.js` — Blockdaemon Universal API + native RPC URL
  builders + headers. Used by `services/bitcoin/*` and the default
  balance provider in `services/multichain/balance-providers/`.
- `helius-client.js` — Helius Enhanced API HTTP construction, used by
  `services/solana/providers/helius-provider.js`.
- `triton-client.js` — Triton One JSON-RPC HTTP construction, used by
  `services/solana/providers/triton-provider.js`.
- `connect-tuning.js` — raises Node's 250ms happy-eyeballs
  per-address connect budget at boot. Required from every Lambda
  entrypoint (`src/index.js`, `src/jobs/handler.js`,
  `src/analytics/handler.js`); the default silently outranks every
  request timeout in the service.
- `cache/` — cache primitives (`cache-helper.js` with the shared Redis
  key/get/set helpers plus the batched `getManyFromCache` (MGET) /
  `storeManyInCache` (MULTI) and `withSingleFlight` (SET NX lock, fresh
  `key` + `key:stale` copy, stale served while one caller rebuilds or when
  the rebuild fails), `transaction-history-cache.js`, `price-cache.js`).
  `src/repositories/helper.js` re-exports `cache-helper.js` for the
  repository layer. Resolve many keys with the batched helpers, never in a
  per-key loop.
- `providers/` — the one door to every upstream provider.
  `provider-client.js#providerCall(name, fn, { locals, environment,
operationName })` applies, in order: request budget (`request-deadline.js`,
  `res.locals.deadline`, default 25 s via `REQUEST_BUDGET_MS`) → circuit
  breaker (`circuit-breaker.js`, Redis state per provider + environment,
  `503 upstream_unavailable` while open, one probe per cooldown,
  `BREAKER_DISABLED=true` bypasses) → shared token bucket
  (`shared-rate-limiter.js`, one Lua script on `ratelimit:<STAGE>:<provider>`,
  in-memory `RateLimiter` fallback when Redis errors, `503
upstream_rate_limited` when the wait does not fit 5 s or the budget) →
  `fn({ timeout, signal })` with the profile timeout capped by the remaining
  budget → classified retry (429/5xx/network, only when the next attempt fits
  the budget) → one CloudWatch EMF line (`metrics.js`, namespace
  `SalmonApi/Providers`, silent under Jest or `METRICS_DISABLED=true`).
  Per-provider numbers live only in `profiles.js` (rps, burst, timeout, retry,
  breaker; `<PROVIDER>_MAX_RPS` overrides). Adding a provider = adding a row.
  `memory-store.js` is the Redis stand-in the fallbacks and the test fake
  (`src/__tests__/helpers/fake-redis.js`) share.
- `rate-limiting/` — pure helpers behind `providers/`: the in-process
  `RateLimiter` bucket (fallback) and `with-retry.js` (`isRetryableError`,
  `getRetryAfter`, `calculateBackoffDelay`). No provider-specific limiters
  live here any more; call sites use `providerCall`.

## Rules

- Keep modules here provider- or technology-shaped, not domain-shaped.
  A "Solana-aware" service belongs in `src/services/solana/`, not here.
- Lazy env reads only — `process.env.X` should be read inside getters
  so tests and runtime env changes are observed without reloading the
  module.
- Do not embed business policy (cache TTL choices, fallback budgets)
  here when it can live with the consumer service. The infrastructure
  module should expose the primitive; the policy is applied above.

## Testing

- Tests live flat in `src/infrastructure/__tests__/` (clients,
  `with-retry`), `src/infrastructure/providers/__tests__/` and
  `src/infrastructure/cache/__tests__/`. Mock the underlying network call;
  never hit the real provider. Mock Redis with `FakeRedis` from
  `src/__tests__/helpers/fake-redis.js` (same commands, Lua bucket semantics
  in JS, `failing = true` exercises the fallbacks). Service specs mock
  `providers/provider-client` with `providerCall: (name, fn) => fn({ timeout,
signal })`. `provider-resilience.integration.spec.js` proves atomicity and
  single-flight against the real Redis.
