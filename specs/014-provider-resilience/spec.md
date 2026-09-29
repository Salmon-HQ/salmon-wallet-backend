# Feature Specification: Provider resilience — one throttling, retry, breaker and cache layer for every upstream

**Feature Branch**: `014-provider-resilience` (stacked on `013-token-data-without-jupiter`)

**Created**: 2026-09-11

**Status**: Draft — approved by the owner for implementation on this branch

**Input**: User description: "Open spec 014 with the six points: shared rate limiting across Lambda containers, batched cache I/O, a bounded time budget per request, a circuit breaker per provider, no thundering herd on cache expiry, and metrics for cache/throttle. It applies to every provider we use and any we may add; make it a good system."

## Context

The API fronts six upstream providers today (CoinGecko, the node provider's
RPC + DAS, the enrichment provider, the routing provider, the balance
provider, the dapp-metadata fetch) and will front more. Each one has its
own request budget, failure modes and cost. Today every Lambda container
throttles on its own memory, so N concurrent containers spend N times the
budget; cache reads and writes for many keys go one round-trip at a time;
retries and timeouts are not bounded by the time the API gateway will wait;
a provider that is down is retried in full by every request; several
containers rebuild the same expired cache entry at once; and none of it is
measured. The result is avoidable 429s, slow balances for large wallets,
requests that keep working after the client gave up, and no way to know
when a paid plan is actually needed.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A traffic spike never turns into provider bans (Priority: P1)

Many users open the wallet at once. The API keeps every provider under its
contracted rate, whatever the number of containers serving the spike;
requests that cannot get a slot in time fail fast with the existing
`503 upstream_rate_limited` instead of hammering the provider.

**Why this priority**: A provider ban or key suspension takes the wallet
down for everyone; this is the failure mode with the widest blast radius.

**Independent Test**: With a provider limited to R requests per second and
K parallel workers issuing requests through K separate processes, the
provider observes at most R per second (plus the configured burst), and
surplus requests answer 503 within the configured wait, never 429 from the
provider.

**Acceptance Scenarios**:

1. **Given** a provider budget of R/s shared by many containers, **When**
   the aggregate demand exceeds R/s, **Then** the aggregate outgoing rate
   stays at R/s and the excess answers 503 `upstream_rate_limited`.
2. **Given** the shared limiter store is unreachable, **When** a request
   needs a slot, **Then** the container falls back to its local limiter
   (degraded, never blocked) and logs the fallback.

---

### User Story 2 - Large wallets stay fast (Priority: P1)

A wallet holding hundreds of tokens loads its balance without paying one
cache round-trip per token.

**Acceptance Scenarios**:

1. **Given** N cached mints, **When** metadata or prices are resolved,
   **Then** the cache is read in one batched operation and written in one
   batched operation, regardless of N.
2. **Given** a 1,000-mint balance with `includeSpam`, **When** requested,
   **Then** it answers within the existing response budget.

---

### User Story 3 - No request outlives the client (Priority: P1)

Every request carries a time budget; provider calls, retries and waits stop
when the budget is spent, and the client gets a truthful error instead of a
gateway timeout.

**Acceptance Scenarios**:

1. **Given** a request budget of B seconds, **When** a provider keeps
   failing, **Then** retries stop before B and the response is the
   provider's classified error (never a gateway timeout).
2. **Given** a retry would land after the budget, **When** the backoff is
   computed, **Then** the call fails immediately with the last error.

---

### User Story 4 - A dead provider costs one probe, not every request (Priority: P2)

When a provider fails repeatedly, the API stops calling it for a cool-down
and answers the classified error immediately; one probe per cool-down
decides when to close the circuit again.

**Acceptance Scenarios**:

1. **Given** F consecutive failures on a provider, **When** the next
   request needs it, **Then** it fails fast with `503 upstream_unavailable`
   and the provider is not called.
2. **Given** the cool-down elapsed, **When** one request probes and
   succeeds, **Then** normal traffic resumes; **When** the probe fails,
   **Then** the circuit stays open for another cool-down.
3. **Given** an open circuit and a cached (even stale) value for the data
   asked, **When** requested, **Then** the stale value is served.

---

### User Story 5 - Cache expiry does not stampede (Priority: P2)

When a shared cache entry expires, exactly one worker rebuilds it while the
others keep serving the previous value.

**Acceptance Scenarios**:

1. **Given** an expired catalog snapshot and many concurrent requests,
   **When** they arrive, **Then** the provider receives one rebuild and the
   others answer from the previous snapshot.
2. **Given** no previous snapshot exists, **When** many requests arrive,
   **Then** one rebuilds and the others wait for it (bounded by the request
   budget), never all rebuilding.

---

### User Story 6 - The operator can see it (Priority: P2)

Cache hit/miss, throttle waits, provider errors by class, breaker state and
retry counts are visible per provider in the existing monitoring, without
new infrastructure.

**Acceptance Scenarios**:

1. **Given** normal traffic, **When** the operator opens the metrics view,
   **Then** per-provider call counts, error counts by class, throttle wait
   time, retries and breaker opens are visible with one-minute resolution.
2. **Given** the cache, **When** read, **Then** hit and miss counts are
   visible per cache family.

### Edge Cases

- The shared limiter must be atomic (no two containers can both take the
  last slot); clock skew between containers must not grant extra slots.
- A provider that returns `retry-after` longer than the remaining budget:
  fail now, do not sleep.
- Breaker state is per provider AND per environment (a devnet outage must
  not open mainnet's circuit).
- Metrics must never throw or add latency beyond a log line.
- Local development without Redis keeps working (in-memory fallbacks).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every outbound provider call MUST go through one shared
  provider-client layer that applies, in order: request budget check,
  circuit breaker, shared rate limit, timeout, classified retry, metrics.
  Adding a provider MUST be a configuration entry (name, rate, burst,
  retry policy, breaker thresholds, timeout), not new plumbing.
- **FR-002**: The rate limiter MUST be shared across containers through the
  existing cache store, atomic, and MUST fall back to the current in-memory
  bucket when the store is unavailable.
- **FR-003**: Cache reads/writes for many keys MUST be batched (one
  round-trip each way).
- **FR-004**: Each request MUST carry a deadline (default below the API
  gateway limit) that bounds every provider wait, timeout and retry.
- **FR-005**: A per-provider circuit breaker MUST open after a configured
  number of consecutive failures, fail fast with `503 upstream_unavailable`
  while open, allow one probe per cool-down, and prefer a stale cached
  value when one exists.
- **FR-006**: Rebuilding a shared cache entry MUST be single-flight with
  stale-while-revalidate for the catalog snapshot and any entry that opts in.
- **FR-007**: Metrics MUST be emitted in CloudWatch Embedded Metric Format
  from the existing logs (no new dependency, no new infrastructure) with
  the dimensions provider, environment and outcome.
- **FR-008**: Existing public contracts and error codes MUST not change,
  except the new `503 upstream_unavailable` for an open circuit.
- **FR-009**: Existing tests MUST keep passing; the new layer MUST have unit
  tests covering limiter atomicity (fake store), fallback, budget cut-off,
  breaker transitions, single-flight and batched I/O.

### Key Entities

- **Provider profile**: name, requests/second, burst, timeout, retry
  policy (max attempts, base delay, max delay, retry-after), breaker
  (failure threshold, cool-down), metric namespace.
- **Request budget**: deadline attached per request, read by every
  provider call.
- **Circuit state**: closed / open-until / half-open, per provider and
  environment.

## Success Criteria _(mandatory)_

- **SC-001**: In a load test with 10 parallel workers against a provider
  stub limited to 5 requests/second, the stub receives no more than 5 + burst
  per second and no 429 is logged.
- **SC-002**: A 1,000-mint balance with `includeSpam` completes at least
  5× faster than today on a warm cache.
- **SC-003**: With a provider stub that always fails, p99 response time of
  the affected endpoint stays under the request budget and the gateway
  never times out.
- **SC-004**: With the circuit open, the provider stub receives at most one
  call per cool-down window.
- **SC-005**: Expiring the catalog under 50 concurrent requests triggers one
  provider rebuild.
- **SC-006**: Per-provider metrics appear in CloudWatch within one minute
  of traffic, with zero code paths that can throw from metrics.

## Assumptions

- Redis (already present) is the shared store; its unavailability degrades
  to per-container behaviour instead of failing requests.
- The request budget default is 25 s (API Gateway hard limit is 29 s).
- Metrics go through CloudWatch EMF log lines, which the platform already
  ingests; dashboards/alarms are an ops follow-up.

## Out of scope

- Distributed tracing, per-user quotas, and provider failover policies
  (which provider replaces which) — those stay in the services that own
  the business decision.
