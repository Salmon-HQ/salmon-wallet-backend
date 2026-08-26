# Testing guide — Salmon API

This guide describes how to run the project's tests, especially the
ones related to the Helius Enhanced Transactions API integration.

## Table of contents

- [Quick start](#quick-start)
- [Running tests locally](#running-tests-locally)
- [Running tests in Docker](#running-tests-in-docker)
- [Test types](#test-types)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

## Quick start

### Quick run (local):

```bash
# All tests
npm test

# Helius-only tests
npm run test:helius
```

### Quick run (Docker):

```bash
# Start containers
docker-compose up -d

# Run tests
./scripts/test-docker.sh all
```

## Integration-spec integrity guard

CI runs only `test:unit`, so `*.integration.spec.js` files are never loaded in CI. To keep them from silently rotting when code is refactored, `src/__tests__/integration-spec-integrity.spec.js` runs **inside the unit suite** and fails the build when any integration spec references code that no longer exists: relative requires that don't resolve, destructured exports that are gone, or member accesses (`service.method`) missing from the module's exports. It never executes the integration specs' network calls. If it flags a spec, fix the spec (or the refactor), not the guard.

## Running tests locally

### Prerequisites

1. Node.js >= 20.0.0 installed
2. Dependencies installed: `npm install`
3. `.env` file populated with the required variables

### Available scripts

```bash
# All tests
npm test

# Unit tests (mocked, no external calls)
npm run test:unit

# Integration tests (real API calls)
npm run test:integration

# Helius-specific tests
npm run test:helius

# Watch mode (for local development)
npm run test:watch

# Coverage report
npm run test:coverage
```

### Run a specific test file

```bash
# By full path
npm test src/services/solana/__tests__/helius-transaction-service.integration.spec.js

# By pattern
npm test helius-transaction-service
```

## Running tests in Docker

### Prerequisites

1. Docker and Docker Compose installed
2. `.env` file populated
3. Containers started: `docker-compose up -d`

### Using the helper script

```bash
# Make it executable (first time only)
chmod +x scripts/test-docker.sh

# Run all tests
./scripts/test-docker.sh all

# Run unit tests
./scripts/test-docker.sh unit

# Run integration tests
./scripts/test-docker.sh integration

# Run Helius tests
./scripts/test-docker.sh helius

# Run with coverage
./scripts/test-docker.sh coverage
```

### Using docker-compose directly

```bash
# All tests
docker-compose exec api npm test

# Specific tests
docker-compose exec api npm run test:helius

# With coverage
docker-compose exec api npm run test:coverage
```

## Test types

### 1. Unit tests

**What they cover:** isolated business logic, data transformations,
type mapping.

**Files:**

Resource specs (`src/resources/solana/__tests__/`):

- `helius-transaction-resource.spec.js`
- `helius-transaction-resource.amounts.spec.js`
- `helius-transaction-resource.nft-helpers.spec.js`
- `helius-transaction-resource.swap-route.spec.js`
- `helius-transaction-resource.swap-route-e2e.spec.js`
- `helius-transaction-resource.type-inference.spec.js`
- `solana-transaction-resource.spec.js`

Service specs (`src/services/solana/__tests__/`):

- `providers.spec.js` — provider resolver (Triton primary, Helius
  fallback)
- `solana-burn-routing.spec.js`
- `solana-ft-swap-service.unit.spec.js`
- other unit specs such as `burn-service.spec.js`,
  `jupiter-service.spec.js`, `solana-ft-service.spec.js`,
  `solana-nft-service.spec.js`, `solana-transaction-service.spec.js`,
  `address-lookup-table-service.spec.js`

**Characteristics:**

- No calls to external APIs
- Use mocks and synthetic data
- Fast (<5 seconds)
- Do not require API keys

**Run:**

```bash
npm run test:unit
```

### 2. Integration tests

**What they cover:** real integration with external APIs (Helius,
Jupiter, Solana RPC).

**Files:**

- `src/services/solana/__tests__/helius-transaction-service.integration.spec.js`
- `src/services/solana/__tests__/solana-transaction-service.integration.spec.js`
- `src/services/solana/__tests__/solana-ft-swap-service.integration.spec.js`

**Characteristics:**

- Make real API calls
- Require valid API keys
- Slower (10-30 seconds)
- 30-second timeout

**Run:**

```bash
npm run test:integration
```

> **Note:** the swap service has a split pair — `solana-ft-swap-service.unit.spec.js` (hermetic, runs under `npm run test:unit`) and `solana-ft-swap-service.integration.spec.js` (live calls, needs a real `.env`).

### 3. End-to-End (E2E) tests

**What they cover:** the full path from controllers down to services.

**Files:**

- `src/controllers/solana/__tests__/solana-account-controller.spec.js`

**Characteristics:**

- Use service mocks
- Validate response structure
- Simulate HTTP requests

**Run:**

```bash
npm test solana-account-controller
```

### 4. Helius-specific tests

**What they cover:** everything related to the Helius Enhanced
Transactions API.

**Includes:**

- helius-transaction-resource unit tests
- helius-transaction-service integration tests
- solana-transaction-service integration tests with Helius

**Run:**

```bash
npm run test:helius
```

## Configuration

### Required environment variables

Create a `.env` file in the project root:

```bash
# Solana data providers
# Triton One — primary provider (RPC + DAS). Embed the token as a path segment.
TRITON_RPC_URL=https://<tenant>.solana-mainnet.rpcpool.com/<token>
TRITON_RPC_URL_DEVNET=

# Helius — fallback only (free tier)
HELIUS_API_KEY=your-helius-api-key

# Caps Helius fallback usage when Triton fails (req/s, default 8)
SOLANA_FALLBACK_MAX_RPS=8

# Required for Jupiter tests
JUPITER_SWAP_URL=https://api.jup.ag/swap/v2
JUPITER_API_KEY=your-api-key-here
JUPITER_SWAP_REFERRAL_ACCOUNT=your-referral-account
JUPITER_SWAP_REFERRAL_FEE_BPS=50

# Optional
SOLANA_FEE_ACCOUNT=9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3
```

#### Solana provider variables in integration tests

The integration tests target the post-migration stack:

- `TRITON_RPC_URL` — primary provider for mainnet. Without this
  value, `src/infrastructure/triton-client.js` throws
  `TRITON_NOT_CONFIGURED` and the resolver routes to Helius. Paste
  the full URL with the token as a path segment
  (`https://<tenant>.solana-mainnet.rpcpool.com/<token>`).
- `TRITON_RPC_URL_DEVNET` — optional. When missing, devnet uses the
  Solana public endpoint (and DAS falls back to Helius).
- `SOLANA_FALLBACK_MAX_RPS` — token-bucket cap for Helius traffic
  when Triton fails. Default 8 req/s; for long local suites you can
  lower it if the free tier is saturated.

For local development copy `.env.example` into `.env` and fill in
`TRITON_RPC_URL` with your Triton credentials.

### Jest configuration

`jest.config.js` is already set up with:

- `testRegex: ['.*.spec.js']` — pattern that finds tests
- `testEnvironment: 'node'` — Node.js test environment
- `timeout: 30000` — 30-second timeout (also configured per test)

## Troubleshooting

### Error: "HELIUS_API_KEY is not defined"

**Fix:** Make sure your `.env` file has the API key:

```bash
echo "HELIUS_API_KEY=your-helius-api-key" >> .env
```

### Error: "Cannot find module '...'"

**Fix:** Install dependencies:

```bash
npm install
```

### Tests time out after 30 seconds

**Possible causes:**

- Helius API is unresponsive
- Rate limiting kicked in
- Slow internet connection

**Fix:**

- Check connectivity: `curl https://api-mainnet.helius-rpc.com`
- Bump the timeout in the specific test: `jest.setTimeout(60000)`
- Use mocks instead of real calls

### Tests fail with "TypeError: fetch is not a function"

**Cause:** Node.js < 18 has no global `fetch`

**Fix:**

1. Upgrade to Node.js >= 18, or
2. Install a polyfill: `npm install node-fetch`

### Tests pass locally but fail in Docker

**Cause:** environment differences

**Fix:**

```bash
# Inspect env vars inside the container
docker-compose exec api printenv | grep HELIUS

# Rebuild the image
docker-compose build api

# Restart the container
docker-compose restart api
```

## Coverage reports

### Generate the coverage report

```bash
# Local
npm run test:coverage

# Docker
./scripts/test-docker.sh coverage
```

### Open the HTML report

```bash
# Generated under coverage/lcov-report/index.html
open coverage/lcov-report/index.html
```

### Target metrics

- **Statements:** > 80%
- **Branches:** > 75%
- **Functions:** > 80%
- **Lines:** > 80%

## CI/CD

Three workflows split the suites by determinism (specs 001–003 under
`specs/`):

- **`ci.yml`** (every PR + push to main): `npm run lint:check`,
  `npm run test:unit`, a credential-free `serverless print` smoke, and
  `npm run test:integration:hermetic` — the curated hermetic integration
  set (today: the redis-connector suite) against a `redis:7-alpine` service
  container. No secrets; safe for fork PRs.
- **`integration-external.yml`** (nightly + manual dispatch, never on PRs):
  `npm run test:integration` against live providers with repository
  secrets. Suites probe their provider and skip with a logged reason when
  unreachable or unconfigured. A red run signals provider drift or a real
  regression — maintainer signal, not a merge blocker.
- **`deploy.yml`** (tag `prod/v*`): re-runs lint + unit as a pre-deploy
  gate.

A new integration suite that only needs docker-compose services belongs in
the hermetic set (extend the `test:integration:hermetic` pattern); anything
that touches a live provider or needs a real key stays external and must
probe-skip, mirroring `triton-provider.integration.spec.js`.

## Testing policy for contributions

What reviewers (human and AI) check when a PR adds or changes behavior. The deterministic gates catch naming, formatting and regressions; this section is the judgment layer they cannot automate.

### Which layer gets the test

Match the test to the layer that owns the behavior — one focused suite beats a broad end-to-end one:

- **`services`** own business flow, fallback policy and caching decisions → test orchestration: which provider gets called, what happens when it fails, what gets cached under which key. Mock providers/repositories with `jest.mock` at the top of the file.
- **`controllers`** translate HTTP → test input extraction, status codes, and error envelopes (`{ error, error_description }`). Mock the service. Expected upstream 404s (e.g. `chart_not_found`, `info_not_found`) are contract cases and need their own test.
- **`resources`** are the public payload contract → test exact field names and shapes. If you touch a resource, a shape assertion must exist — deployed wallets parse these fields with no compile-time signal.
- **`repositories`/`infrastructure`** → unit-test only real logic (key construction, TTL policy, error mapping). Plumbing that just forwards to a client does not need a unit test.
- **`routes`** rarely need tests; the layer is wiring. Exceptions exist where the wiring IS the contract (e.g. the blockchains-registry spec).

### Hard rules

1. **Unit tests are hermetic.** No network, no Redis, no real `.env`. `jest.mock` axios and `repositories/data-source` wherever the module under test can reach them. CI runs `test:unit` with dummy env values — a test that needs a real key is misnamed.
2. **A suite that touches a live service is `*.integration.spec.js`** — enforced by the naming split. If it only needs docker-compose services (Redis), it can join the hermetic set in the PR gate; if it hits a provider, it runs in the nightly and MUST probe first: hit the provider directly (raw axios, not through the code under test) and skip with a logged reason when unreachable or unauthenticated. Never guard with `expect(process.env.X).toBeDefined()` — `jest.setup.js` injects dummies that satisfy it.
3. **A test that cannot fail is worse than no test.** No `typeof x === 'function'` placeholders, no try/catch that accepts both outcomes, no asserting a mock returns the mock, no restating a lookup table. If you cannot make it fail by breaking the code, delete it.
4. **Bug fixes ship with the regression test that fails on the old code.** Same PR, same commit if possible.
5. **Behavior changes to a contract listed in `AGENTS.md` need tests at the contract's layer** plus a consumer check in the sibling frontend repo.

### What NOT to test

Trivial mappers with no branching, config/constant plumbing, framework behavior (Express routing, jest itself), and provider payloads verbatim (that is the nightly's job). Coverage has no numeric gate here on purpose: reviewers judge whether the _new_ behavior is covered, not whether a percentage moved.

### Conventions

- AAA structure (arrange / act / assert), one behavior per test.
- Descriptive names that state the behavior: `returns null when Jupiter has no quote`, not `test price 2`.
- Timeouts: unit ~5 s default; integration declares its own budget with a comment when it needs more.
- Clean up what you create (open handles fail the suite — `--detectOpenHandles` is on).

## Resources

- [Jest documentation](https://jestjs.io/docs/getting-started)
- [Helius API docs](https://www.helius.dev/docs)
- [Project architecture](./ARCHITECTURE.md) — Solana provider model
  (Triton primary, Helius fallback) and stack migration notes.
