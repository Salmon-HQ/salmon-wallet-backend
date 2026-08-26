# Salmon API

Salmon API is the backend that powers the Salmon wallet across mobile, web, and extension. It exposes multi-chain endpoints (Solana, Bitcoin), token / price / bridge / swap / NFT services.

## Stack

- Node.js `>=20.0.0` (matches the `nodejs20.x` Lambda runtime)
- Express, deployed via the Serverless Framework (`serverless-offline` for local dev)
- Redis (cache)
- Jest for unit and integration tests

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env and edit local values
cp .env.example .env

# 3. Start Redis (and optionally the backend container)
docker-compose up -d redis

# 4. Start the API locally with serverless-offline
npm run serverless:start:local
```

By default the offline HTTP server listens on `OFFLINE_HTTP_PORT` (3000) with the lambda port on `OFFLINE_LAMBDA_PORT` (3002).

## Required Environment

The full set of variables lives in [`.env.example`](./.env.example). The most important ones for Solana traffic:

| Variable                                                                              | Purpose                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRITON_RPC_URL`                                                                      | Mandatory for mainnet. Both surfaces — **transaction enrichment** (`dispatchTx`) and **DAS / NFT** (`dispatchDas`) — go through the same `dispatchWithFallback` routine in `src/services/solana/providers/index.js`: Triton first, and Helius as fallback both when Triton is not configured for the environment and when a Triton call fails with a fallback-eligible error.                         |
| `TRITON_RPC_URL_DEVNET`                                                               | Optional. When unset, devnet routes to the public Solana endpoint (and DAS to Helius).                                                                                                                                                                                                                                                                                                                |
| `TRITON_API_TOKEN`                                                                    | Optional. Appended as a path segment when `TRITON_RPC_URL` is a bare `rpcpool.com` host. Most deployments embed the token in the URL and leave this unset. Read by `src/infrastructure/triton-client.js`.                                                                                                                                                                                             |
| `HELIUS_API_KEY`                                                                      | Fallback only. Used by the resolver when Triton errors or is not configured.                                                                                                                                                                                                                                                                                                                          |
| `HELIUS_TIER`                                                                         | Optional. Set to `paid` to widen Helius rate limits; defaults to free tier (10 req/s burst 20). Read by `src/infrastructure/rate-limiting/helius-rate-limiter.js`.                                                                                                                                                                                                                                    |
| `SOLANA_FALLBACK_MAX_RPS`                                                             | Token-bucket cap (default 8) on Helius fallback traffic to keep the free tier safe.                                                                                                                                                                                                                                                                                                                   |
| `ETHEREUM_MAINNET_RPC_URL`, `ETHEREUM_SEPOLIA_RPC_URL`                                | Optional overrides for default Ethereum RPC endpoints (`https://eth.llamarpc.com`, `https://rpc.sepolia.org`). Read by `src/constants/networks.js`.                                                                                                                                                                                                                                                   |
| `JUPITER_PRICE_URL`, `JUPITER_SWAP_URL`, `JUPITER_API_KEY`                            | Jupiter Swap API v2 (Ultra successor) + Price v3.                                                                                                                                                                                                                                                                                                                                                     |
| `JUPITER_SWAP_REFERRAL_ACCOUNT`, `JUPITER_SWAP_REFERRAL_FEE_BPS`                      | Jupiter referral wiring.                                                                                                                                                                                                                                                                                                                                                                              |
| `REDIS_*`                                                                             | Redis connectivity (defaults work against the docker-compose stack).                                                                                                                                                                                                                                                                                                                                  |
| `RATE_LIMIT_MODE`, `RATE_LIMIT_MAX`, `RATE_LIMIT_TX_MAX`, `RATE_LIMIT_WINDOW_SECONDS` | Per-IP rate limiting (fixed window in Redis, fail-open), configured in `src/index.js`. `RATE_LIMIT_MODE` defaults to `enforce` in prod (`config/env.prod.yml`) and to `log` (count and log, don't block) locally (`config/env.local.yml`); the global limiter defaults to 300 req/60s over `/v1`, with a stricter 30 req/60s limiter on the transaction-building routes (NFT burn/transfer, FT swap). |

Solana data path summary: **Triton One is the primary provider (RPC + DAS), Helius is the rate-limited fallback, bare RPC is the last resort.** See `src/services/solana/providers/` and `docs/ARCHITECTURE.md` for the routing model.

## Tests

Scripts defined in `package.json`:

```bash
npm test                 # all tests with --detectOpenHandles
npm run test:unit        # *.spec.js excluding integration suites
npm run test:integration # only *integration.spec.js (runInBand)
npm run test:helius      # Helius-pattern specs only
npm run test:watch       # watch mode
npm run test:coverage    # coverage report
```

Docker-based test runs are documented in `docs/TESTING.md` (`./scripts/test-docker.sh ...`).

## Deploy

Production deploys are tag-triggered via CI (GitHub Actions + OIDC, no long-lived AWS keys). Secrets live in AWS SSM Parameter Store, not in the repo. See [`docs/DEPLOY.md`](./docs/DEPLOY.md) for the full model, how to add/rotate a secret, and local dev setup.

## Documentation

- [`docs/openapi.yaml`](./docs/openapi.yaml) — OpenAPI 3.0 reference for the public HTTP API.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — layered architecture, Solana slice, package ownership.
- [`docs/TESTING.md`](./docs/TESTING.md) — running tests locally and in Docker.
- [`docs/DEPLOY.md`](./docs/DEPLOY.md) — CI/CD deploy model, SSM secrets, local setup.
- [`docs/ANALYTICS.md`](./docs/ANALYTICS.md) — anonymous usage-analytics ingest (`POST /v1/events`) and the GA4 sink.
- [`AGENTS.md`](./AGENTS.md) — operating rules for AI agents working in this repo.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`SECURITY.md`](./SECURITY.md), [`CHANGELOG.md`](./CHANGELOG.md) — contribution rules, vulnerability disclosure, release notes.
