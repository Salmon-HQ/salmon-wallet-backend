# Salmon API architecture

This document describes the repository's architecture by folder
responsibility. Goal: understand where each kind of logic lives and
what criteria to follow when adding or moving code.

## Big picture

The repo follows a layered structure with an extra vertical cut by
blockchain. Each chain (`bitcoin`, `solana`, `ethereum`) lives as a
parallel slice inside `routes/`, `controllers/`, `services/` and
`resources/`. Cross-chain endpoints live in a `multichain/` slice.
Services with no chain affinity (CoinGecko, network catalog /
capabilities, dapp metadata, scam list, Trustwallet) live in `shared/`
inside each layer.

Main flow:

`routes` -> `controllers` -> `services` -> `repositories` / `infrastructure` -> `resources`

That is:

- `routes` expose endpoints and wire middlewares.
- `controllers` translate HTTP into application calls.
- `services` own business logic and orchestration.
- `repositories` and `infrastructure` access data or external services.
- `resources` map internal results into the public API contract.

### Per-blockchain mount loop

`src/index.js` iterates over the `BLOCKCHAINS` constant (defined in
`src/constants/blockchains.js`) and mounts each slice at
`/v1/<chain>-:env` (e.g. `/v1/solana-:env`). A mount-level inline
resolver reads `:env`, builds the canonical `<chain>-<env>` network
id, validates it against `NETWORKS`, and writes
`res.locals.network`. Path-level isolation guarantees that a request
for `/v1/solana-mainnet/...` only matches the solana mount — slice
routers all expose `/account/...` paths, so without a chain-prefixed
mount path they would shadow each other. The cross-chain endpoints
under `src/routes/multichain/` keep using `:networkId` directly
because their handler dispatches on `res.locals.network.blockchain`.

Adding a new blockchain to the loop = append it to `BLOCKCHAINS` and
provide `src/routes/<chain>/index.js`. The constants spec
(`src/constants/__tests__/blockchains.spec.js`) fail-fasts when the
two diverge.

### Plug-points for new blockchains

- `BLOCKCHAINS` in `src/constants/blockchains.js`: list of chains with
  code present.
- `src/services/multichain/balance-providers/`: registry for per-chain
  balance overrides. The default uses Blockdaemon Universal and covers
  any chain Blockdaemon supports. A chain with a richer provider
  (Alchemy/Infura for Ethereum) registers in `PROVIDERS_BY_CHAIN`.
- `src/network-capabilities/network-capabilities-${stage}.js`:
  per-environment gating. A chain can be in `BLOCKCHAINS` without
  appearing in any stage's `enable` list (current Ethereum: code is
  present, FE never sees it).
- `BALANCE_CHAINS` in `src/routes/multichain/account-router.js`:
  explicit allowlist of chains exposed on the multichain balance
  endpoint.

## Folder responsibilities

### Repo root

- `src/`
  - main API code.
- `docs/`
  - living project docs: testing, functional migrations, ops
    decisions, architecture.
- `docker/`
  - local-environment files and Redis bootstrap.
- `scripts/`
  - local-ops auxiliary scripts (today mostly Docker-based testing).
- `packages/`
  - internal reusable packages. Shared infrastructure utilities or
    helpers, not the default home for new feature code.

### `src/`

#### `src/routes/`

Responsibility:

- declare paths
- apply middlewares
- delegate to controllers

Should NOT contain:

- business logic
- data access
- complex response serialization

Important subfolders:

- `src/routes/solana/`
  - Solana HTTP surface (account, FT, NFT)
- `src/routes/bitcoin/`
  - Bitcoin HTTP surface (transactions + utxo; read-only)
- `src/routes/multichain/`
  - cross-chain routes that dispatch on
    `locals.network.blockchain` (today `account/:address/balance`)
- `src/routes/ethereum/`
  - skeleton: empty router mounted by the loop with no endpoints
    registered
- `src/routes/shared/`
  - chain-agnostic routers (`coingecko`, `dapp`, `network`,
    `info`) plus the `network-route-path.js` helper used by
    multichain routes

#### `src/controllers/`

Responsibility:

- read request input
- extract params/query/body
- pick the right service to invoke
- return HTTP response

Should NOT contain:

- heavy domain logic
- direct calls to external APIs
- complex payload transformations

Important subfolders:

- `src/controllers/solana/`
  - Solana account, FT, NFT controllers
- `src/controllers/bitcoin/`
  - Bitcoin domain controllers (account)
- `src/controllers/multichain/`
  - cross-chain controllers that dispatch on
    `res.locals.network.blockchain`
- `src/controllers/ethereum/`
  - skeleton
- `src/controllers/shared/`
  - chain-agnostic controllers (`coingecko`, `dapp`, `network`,
    `info`)

#### `src/services/`

Responsibility:

- business logic
- composition across multiple sources
- fallback policy
- high-level caching
- flow decisions

This folder is the heart of the application. When a change affects
behavior it almost always lands here.

Important subfolders:

- `src/services/solana/`
  - the densest domain in the project
  - groups transactions, NFTs, FT, swaps, burn, and Helius/Jupiter
    wrappers
- `src/services/bitcoin/`
  - Bitcoin vertical slice: transactions, UTXO (read-only); HTTP client
    at `src/infrastructure/blockdaemon-client.js`
- `src/services/multichain/`
  - endpoints that dispatch on `locals.network.blockchain`. Today
    holds `account-service.js` (balance) and `balance-providers/`
    (registry for per-chain balance overrides; default: Blockdaemon
    Universal)
- `src/services/shared/`
  - chain-agnostic services: `coingecko-service`,
    `dapp-service`, `network-capabilities-service`,
    `network-catalog-service`, `scam-service`, `trustwallet-service`
- `src/services/ethereum/`
  - skeleton

Expected design:

- a service may lean on repositories, clients, and even other services
- it should NOT return raw HTTP payloads when the shape depends on the
  public contract; that is what `resources` are for

#### `src/repositories/`

Responsibility:

- access data sources
- access caches or persistent sources
- adapt to data providers when the problem is read/write rather than
  orchestration

Should NOT contain:

- HTTP logic
- high-level business rules

Important subfolders:

- `src/repositories/shared/`
  - chain-agnostic repositories: `coingecko-repository`,
    `scam-repository`, `trustwallet-repository`
- `src/repositories/solana/`
  - Solana-specific data access

#### `src/resources/`

Responsibility:

- transform internal results into the API-exposed format
- encapsulate response shape
- centralize output mappings

Right layer for:

- renaming fields
- normalizing structures
- modeling transaction input/output

Important subfolders:

- `src/resources/solana/`
  - serialization and transformation for transactions, accounts, FT,
    NFT, and swaps
- `src/resources/bitcoin/`
  - Bitcoin transaction and UTXO shapes
- `src/resources/shared/`
  - cross-chain shapes (`account-balance-resource`,
    `network-resource`) and the cross-cutting
    `resource-includes.js` (`includeLogo` / `includeBlacklisted`)

#### `src/infrastructure/`

Responsibility:

- shared clients
- technical connectors
- reusable setup for external providers

This is where transversal pieces live that do not belong to a single
business domain.

Important subfolders:

- `src/infrastructure/cache/`
  - cache primitives and helpers
- `src/infrastructure/rate-limiting/`
  - rate-limit control for external integrations

#### `src/middlewares/`

Responsibility:

- per-request transversal validations and restrictions
- Express concerns that must run before the controller

Typical examples:

- origin
- multinetwork
- admin-permission gates
- rate-limit (per-IP fixed window in Redis, fail-open; wired in
  `src/index.js` with a global `/v1` limiter plus a stricter one on
  transaction-building routes — see `RATE_LIMIT_*` in the README)

#### `src/constants/`

Responsibility:

- shared domain constants and static configuration

Must remain a folder of immutable data, not a place for functions with
growing logic.

#### `src/network-capabilities/`

Responsibility:

- per-environment / per-stage network capability matrix
- private enable-flag and section gating per network

The intent is to separate configurable behavior from domain code.

#### `src/utils/`

Responsibility:

- small, genuinely cross-cutting helpers

Practical rule:

- if something is Solana-only, it should live next to Solana
- `utils/` should be reserved for helpers that are clearly shared

#### `src/jobs/`

Responsibility:

- async / scheduled processes outside the normal request/response
  loop

Today its weight is smaller than `src/services/`, but conceptually it
is the right layer for batch or scheduled work.

#### `src/__tests__/` and local `__tests__/`

Responsibility:

- global tests when scope does not belong to a single folder
- tests next to code when local context matters

The repo uses both styles. The healthier rule is to keep a test next
to the module it covers when it targets a specific behavior of that
module.

## Solana slice

Solana is the most developed sub-domain and follows a consistent
vertical structure:

- `src/routes/solana/`
- `src/controllers/solana/`
- `src/services/solana/`
- `src/repositories/solana/`
- `src/resources/solana/`

That keeps the domain relatively isolated from the rest of the
backend.

### What belongs in Solana Services

- integration with Solana data providers (Triton primary, Helius
  fallback, bare RPC as last resort)
- Jupiter integration
- transaction orchestration
- enrichment preloading for both transaction paths: the service batches
  the lookups each mapper needs (`loadEnrichment` for the enriched path,
  `solana-rpc-enrichment.js` for the bare-RPC fallback), so resources
  stay pure mappers with no network I/O
- burn routing
- FT/NFT fetching
- account- and swap-specific logic

### Solana data providers

Triton One is the primary provider for RPC and DAS (NFT metadata,
NFTs by owner, batches). Helius is the rate-limited fallback (cap
configurable via `SOLANA_FALLBACK_MAX_RPS`, default 8 req/s) and
public RPC is the last resort.

- `src/services/solana/providers/index.js` is the resolver: routes
  every call to Triton first and, if Triton fails or is not
  configured, allows up to `SOLANA_FALLBACK_MAX_RPS` requests per
  second to Helius. Both surfaces — transaction enrichment
  (`dispatchTx`) and DAS (`dispatchDas`) — share the same
  `dispatchWithFallback` routine, so DAS also falls back to Helius on
  Triton _errors_, not only when Triton is unconfigured for the
  environment (e.g. devnet without `TRITON_RPC_URL_DEVNET`).
- `src/services/solana/providers/` holds the adapters
  `triton-provider.js`, `helius-provider.js`, the
  `solana-data-provider.js` contract (including
  `ProviderNotImplementedError`), and `das-shared.js`.
- `src/services/solana/parser/` is the local parsing pipeline that
  compensates for the fact that Triton has no equivalent of Helius
  Enhanced Transactions. It classifies transactions from each
  instruction's program IDs.
- `src/services/solana/parser/parsers/` contains the per-program
  parsers: `system`, `spl-token`, `metaplex`, `bubblegum`, `jupiter`,
  `stake`, `staking`, `lending`, `dex`, plus the `_hint-parser.js`
  helper.
- The HTTP/RPC clients live in `src/infrastructure/triton-client.js`
  and `src/infrastructure/helius-client.js`. `triton-client.js` throws
  `TRITON_NOT_CONFIGURED` when `TRITON_RPC_URL` is not set on mainnet;
  the resolver catches that error to route to Helius.

### What belongs in Solana Resources

- transaction serialization
- final shape for FT/NFT/account responses
- input/output mappings consumed by the frontend

### Two-stage transaction shaping (deliberate)

Transaction history/detail responses are shaped in two stages, split by
the internal `_source` discriminator:

1. Enriched transactions (Triton parser or Helius Enhanced API) are
   shaped **inside `solana-transaction-service`** by
   `helius-transaction-resource` (the canonical enriched mapper) and
   tagged `_source: 'enriched'`. The service owns this stage because
   only it holds the per-page enrichment context (`tokenLookup`,
   `nftMetadataByMint`) batched by `loadEnrichment`, and because raw
   provider payloads must not leak above the service layer.
2. The controller then applies `solana-transaction-resource` via the
   generic decorator. For enriched transactions this is a passthrough
   that strips the `_source` tag; for bare-RPC fallback transactions it
   builds the full shape from the lookups preloaded by
   `solana-rpc-enrichment.js`.

Do not merge the two mappers or move the enriched shaping into the
controller: `helius-transaction-resource`'s signature is intentionally
not decorator-compatible, and hoisting it would force the service to
return raw provider payloads plus enrichment context through its public
return shape. The first-page history cache
(`withCachedTransactionHistory`) wraps decoration in the controller, so
it stores the final post-shape payload under either arrangement — the
layering, not the cache, is the constraint.

## Bitcoin slice

Bitcoin follows the same vertical structure as Solana, with a smaller
surface:

- `src/routes/bitcoin/` — `bitcoin-account-router.js` (transactions,
  utxo; the wallet broadcasts signed transactions itself)
- `src/controllers/bitcoin/` — `bitcoin-account-controller.js`
- `src/services/bitcoin/` — `bitcoin-transaction-service`,
  `bitcoin-utxo-service`
- `src/resources/bitcoin/` — `bitcoin-transaction-resource`,
  `bitcoin-utxo-resource`

The Blockdaemon HTTP client lives in
`src/infrastructure/blockdaemon-client.js` so any slice (Bitcoin
today, Ethereum tomorrow if it uses Blockdaemon Universal) reuses the
same URL/header construction.

## Multichain slice

Endpoints that serve more than one blockchain under the same handler.
Today: balance.

- `src/routes/multichain/account-router.js` —
  `GET /v1/:networkId/account/:address/balance`. The explicit
  allowlist is the `BALANCE_CHAINS` constant.
- `src/controllers/multichain/account-controller.js` — thin HTTP
  wrapper.
- `src/services/multichain/account-service.js` — resolves a
  `BalanceProvider` per chain and delegates.
- `src/services/multichain/balance-providers/` — registry.
  `blockdaemon-balance-provider.js` is the default (covers any
  Blockdaemon-supported chain).
  `index.js#PROVIDERS_BY_CHAIN` maps chain -> provider for future
  overrides.
- `src/services/multichain/price-enrichers/` — per-chain USD price
  decoration of balance items (Solana via Jupiter Price v3, Bitcoin
  via the CoinGecko repository). Same registry pattern as
  balance-providers; see the folder's `AGENTS.md`.

## Analytics slice

`src/analytics/` is a self-contained ingest surface, deliberately
outside the chain-slice model:

- `handler.js` — a dedicated Lambda (`events` in `serverless.yml`,
  explicit `POST /v1/events` route) so an event-traffic spike cannot
  starve the main `api` function's concurrency.
- `event-schema.js` — allow-list re-validation of event names and
  context (semver-checked `appVersion`).
- `sink.js` — env-selected sink: `file` (NDJSON, local/tests default)
  or `ga4` (Google Analytics 4 Measurement Protocol). The handler
  never reads the client IP and the ga4 sink never forwards it.

It does not follow routes/controllers/services layering because it has
exactly one route and no business flow; the full design and privacy
model live in `docs/ANALYTICS.md`.

## Ethereum slice (skeleton)

- `src/routes/ethereum/index.js` — empty Express router. The mount
  loop mounts it so `BLOCKCHAINS` does not blow up at boot, but no
  endpoint is registered.
- `src/{controllers,services,resources}/ethereum/` — AGENTS.md only.
- The networks (`ethereum-mainnet`, `ethereum-sepolia`) live in
  `src/constants/networks.js` but are NOT in any
  `network-capabilities-${stage}.enable` list. The FE does not see
  them.

## Adding a new blockchain

1. Add the constant (e.g. `POLYGON`) and append it to `BLOCKCHAINS`
   in `src/constants/blockchains.js`.
2. Add the networks in `src/constants/networks.js` with their
   RPC/explorer config.
3. Create `src/routes/<chain>/index.js` (an empty router is fine to
   start). The mount loop in `src/index.js` picks it up without an
   edit. The test
   `src/constants/__tests__/blockchains.spec.js` fails fast if you
   add the chain to the array without creating this file — it acts
   as a fail-fast safety net.
4. When you want to expose endpoints, scaffold the slices:
   `controllers/<chain>/`, `services/<chain>/`, `resources/<chain>/`.
5. If the multichain balance endpoint should serve this chain, add
   the constant to `BALANCE_CHAINS` in
   `src/routes/multichain/account-router.js`. If Blockdaemon
   Universal does NOT cover this chain or you want a richer provider,
   register a custom provider in
   `src/services/multichain/balance-providers/index.js#PROVIDERS_BY_CHAIN`.
6. When you want to expose the chain to the FE: add the network ids
   to the `enable` array of the stage files in
   `src/network-capabilities/network-capabilities-{develop,local,main,prod}.js`.

## `packages/`: when yes, when no

`packages/` contains shared internal utilities. Recommended rule:

- use `packages/` for cross-cutting pieces reusable across contexts
- do NOT move feature code there just to "tidy up"

If logic depends heavily on the Salmon API domain, it usually belongs
in `src/`, not `packages/`.

## Guide for adding new code

### Adding a new endpoint

- `routes/` to register the path and middlewares
- `controllers/` for HTTP input/output
- `services/` for behavior
- `repositories/` or `infrastructure/` if a new source appears
- `resources/` if the output needs a stable public shape

### Adding a new third-party integration

- shared client or technical setup in `infrastructure/` if reused
- business wrapper in `services/`
- external -> internal serialization in `resources/` if needed

### Adding blockchain-specific logic

- prefer the per-domain cut inside `src/*/<blockchain>/`
- do not mix Solana logic with generic helpers unless they are truly
  shared

## Signs that a file is in the wrong place

- a `controller` starts talking to multiple external providers
- a `route` does complex validation or mapping
- a `resource` makes business decisions
- a `repository` starts orchestrating flows
- a helper in `utils/` is only used by one domain folder
- a constant depends on state or environment

## Current design state

Today the repo is reasonably well organized. The main decisions are
coherent:

- clear layers
- per-blockchain vertical slices (Solana, Bitcoin, Ethereum skeleton)
  plus multichain and shared horizontals
- resources separated from services
- repositories separated from controllers

What is left as a maintenance criterion is not big restructuring —
just preserving that discipline:

- keep controllers thin
- prevent `utils/` from becoming a mixed dumping ground again
- use `resources` for public contracts
- use `services` for real orchestration

## Relationship with `AGENTS.md`

This document describes the human-readable architecture of the repo.
`AGENTS.md` complements it with operational rules for future agents:

- where to touch code
- which tests to run
- which contracts not to break
- how to decide where new changes land
