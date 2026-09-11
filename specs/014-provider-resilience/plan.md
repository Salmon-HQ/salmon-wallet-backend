# Implementation Plan: Provider resilience

**Branch**: `014-provider-resilience` (stacked on 013) | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

## Summary

One module family under `src/infrastructure/providers/` replaces the
per-provider limiter files: a provider profile table, a Redis-backed atomic
token bucket (Lua) with in-memory fallback, a circuit breaker with state in
Redis, a per-request deadline, classified retry bounded by that deadline,
and EMF metrics. `cache-helper` gains batched read/write and a single-flight
stale-while-revalidate helper. Every current provider call site migrates to
`providerCall(name, fn, opts)`.

## Technical Context

Node 24, Express 5, `redis` v5 client (`packages/redis-connector`, supports
`EVAL`/`MGET`/`MULTI`), Jest 30, Lambda behind API Gateway (29 s). Existing
pieces reused: `RateLimiter` (becomes the fallback bucket), `with-retry.js`
(`isRetryableError`, backoff), `cache-helper` key scheme, `error-handler`
(renders `statusCode` + `errorCode`).

## Design

```
src/infrastructure/providers/
├── profiles.js            # PROVIDERS = { coingecko, helius, triton, zeroex, blockdaemon, dapp }: rps, burst, timeoutMs, retry {maxAttempts, baseMs, maxMs, honorRetryAfter}, breaker {failures, cooldownMs}
├── request-deadline.js    # middleware: res.locals.deadline = now + REQUEST_BUDGET_MS (default 25000); remaining(locals); throws 503 request_budget_exhausted
├── shared-rate-limiter.js # acquire(name, rps, burst) → Lua EVAL on `ratelimit:<stage>:<name>` (tokens, ts) returns waitMs; falls back to in-memory RateLimiter when Redis errors; sleeps min(waitMs, remaining) else 503 upstream_rate_limited
├── circuit-breaker.js     # state on `breaker:<stage>:<env>:<name>` {failures, openUntil}; isOpen(), recordSuccess(), recordFailure(); half-open = one probe token via SET NX; open → 503 upstream_unavailable
├── metrics.js             # emit(namespace, dims, values) → one JSON line in CloudWatch EMF (`_aws.CloudWatchMetrics`); never throws; counters: ProviderCalls, ProviderErrors{class}, ThrottleWaitMs, Retries, BreakerOpen, CacheHit, CacheMiss
└── provider-client.js     # providerCall(name, fn, { locals, operationName, cacheKeyForStale? }): deadline → breaker → limiter → fn({ signal, timeout }) → classify → retry (bounded by remaining) → metrics
src/infrastructure/cache/cache-helper.js   # + getManyFromCache(keys) (MGET), storeManyInCache(entries, ttl) (MULTI), withSingleFlight(key, { ttl, staleTtl, lockMs, rebuild })
```

Migration (call sites): `coingecko-service` (all fetches), `helius-provider`

- `helius-transaction-service`, `triton-provider` + `token-metadata-service`
  (DAS, no limiter today), `zeroex-swap-provider`, `blockdaemon-balance-provider`
  (no limiter today), `dapp-service` (fetch through guard). Old
  `*-rate-limiter.js` files are deleted; `with-retry.js` keeps only the pure
  helpers. `token-metadata-service` and `price-cache` switch to the batched
  helpers; `token-catalog-service` rebuilds the snapshot through
  `withSingleFlight` (stale served while one worker rebuilds; if the circuit
  is open and a stale snapshot exists, serve it).

Axios timeouts become the profile timeout capped by the remaining budget;
an `AbortController` signal is passed so a spent budget cancels the socket.

Config (env, all optional): `REQUEST_BUDGET_MS`, `<PROVIDER>_MAX_RPS`
overrides (keeps `ZEROEX_MAX_RPS`, adds the rest), `BREAKER_DISABLED=true`
for local runs.

## Test plan

- `shared-rate-limiter.spec.js`: fake Redis with the Lua semantics
  (atomic consume, refill by elapsed time, burst cap); two "containers"
  share one budget; Redis error → in-memory fallback + one warn.
- `circuit-breaker.spec.js`: closed → open after N failures → half-open one
  probe → closed/open; per-provider+env isolation; disabled flag.
- `request-deadline.spec.js`: remaining(), exhausted → 503.
- `provider-client.spec.js`: order of gates; retry stops before deadline;
  retry-after longer than remaining fails now; metrics emitted with
  outcome; stale-on-open path.
- `cache-helper.spec.js`: MGET/MULTI shapes; single-flight lock with stale
  serve; lock timeout.
- Migrated services: existing specs updated to mock `provider-client`.
- Hermetic Redis integration (already in CI): limiter atomicity with two
  processes, single-flight with concurrent callers.

## Rollout

Ships dark: identical behaviour with Redis up (tighter, shared budgets),
in-memory fallback otherwise. Metrics appear in CloudWatch under namespace
`SalmonApi/Providers`; dashboard + alarms on `ProviderErrors` and
`BreakerOpen` are an ops follow-up.

## Deviations

- `providerCall` takes an `environment` option next to `locals`: the Helius / Triton readers receive an environment string, not `res.locals`, and the breaker scope needs it.
- Per-call axios timeouts survive as `Math.min(<call timeout>, ctx.timeout)` so the tighter budgets already in place (e.g. 2 s exchange rates) are not widened to the profile cap.
- `dapp` has no breaker (`breaker: null`): every dapp is a different host, so one broken dapp would open the circuit for all. It keeps the limiter, timeout and budget.
- `withSingleFlight` serves the stale copy on _any_ rebuild failure, not only an open circuit; that is the smallest path to FR-005's "prefer stale" and matches the coingecko long-term fallback already in the repo. No `cacheKeyForStale` option on `providerCall`.
- Breaker state is three plain keys (`:failures` INCR, `:open` SET PX, `:probe` SET NX PX) instead of one JSON blob, so writes are atomic without a second Lua script.
- The in-memory fallback + the test fake share `providers/memory-store.js`; `src/__tests__/helpers/fake-redis.js` adds a JS port of the bucket script and a `failing` switch.
- The bare-RPC path (`locals.network.config.nodeUrl`, `@solana/web3.js` Connection) is not a profiled provider and stays outside `providerCall`; Triton JSON-RPC reads in `parser/triton-rpc.js` are inside.
- `redis-connector` gained `mGet`, `setMany` (MULTI), `eval`, `pExpire` wrappers; nothing else in the connector changed.
- `docs/openapi.yaml` has no 503 description list, so it was left untouched.
