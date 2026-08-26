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
  key/get/set helpers, `transaction-history-cache.js`,
  `price-cache.js`). `src/repositories/helper.js` re-exports
  `cache-helper.js` for the repository layer.
- `rate-limiting/` — token-bucket rate limiters and `with-retry.js`
  factory shared by Jupiter, CoinGecko, Helius.

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

- Tests live flat in `src/infrastructure/__tests__/` (clients) and in
  `src/infrastructure/rate-limiting/__tests__/` (rate limiters and
  the `with-retry` factory). Mock the underlying network call; never
  hit the real provider.
