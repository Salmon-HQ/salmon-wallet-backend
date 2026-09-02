# Research: Replace the archived SPL Token Registry

Date: 2026-09-02. All probes done live; all doc claims from official sources.

## Decision 1 — Source for devnet/testnet token lists

**Decision**: the solana-labs jsDelivr CDN JSON already fetched by
`cdn-token-list-service` (`CDN_TOKEN_LIST_URL`), filtered by `chainId`.

**Rationale**: `@solana/spl-token-registry` is a build-time snapshot of that
exact file. Verified 2026-09-02 that `filterByClusterSlug()` in
`@solana/spl-token-registry@0.2.4574` and a `chainId` filter over the CDN file
yield identical counts:

| cluster      | package | CDN (`chainId`) |
| ------------ | ------- | --------------- |
| mainnet-beta | 13053   | 13053 (101)     |
| testnet      | 62      | 62 (102)        |
| devnet       | 529     | 529 (103)       |

Same data, one dependency deleted, no new provider, no new env var. Upstream
`solana-labs/token-list` is archived (last push 2024-07-24), so `@latest`
never moves; the data is frozen under every option.

**Alternatives considered**:

- **Jupiter Token API v2** (`developers.jup.ag/docs/tokens/v2`) — mainnet only;
  no cluster parameter, no devnet surface. Already used for `/ft/verified`
  (`tag?query=verified`) and `/ft/search`; unchanged.
- **Helius DAS** (`getAsset` / `searchAssets`) — has devnet, but is per-mint,
  not a catalog. Adopting it means rewriting `locals.tokens` from an array into
  a lazy resolver across four call sites (`solana-transaction-service.js:74`,
  `solana-rpc-enrichment.js:55`, `solana-balance-provider.js`, and the two
  resource readers). Out of proportion for frozen devnet labels.
- **CoinGecko** (`src/services/shared`, hourly job) — indexes mainnet contract
  addresses only; no devnet mints.
- **Scheduled job + Redis cache** — unnecessary: the data is static and
  `list()` already has a 1 h in-memory cache with inflight dedup.

## Decision 2 — Return raw entries, not `normalizeCdnEntry`

**Decision**: `getClusterTokens` returns the CDN entries unmapped.

**Rationale**: `normalizeCdnEntry` targets the Jupiter v2 shape
(`id`, `icon`) consumed by `solana-ft-batch-resource`. `list()` consumers read
`address`, `symbol`, `name`, `decimals`, `logoURI` — the registry's own shape —
via `tokens.find(t => t.address === mint)` in
`solana-transaction-resource.js:216` and `helius-transaction-resource.js:105`.
Mapping would break them.

## Decision 3 — Failure policy

**Decision**: throw on CDN failure and on unknown environment; nothing cached.

**Rationale**: AGENTS.md "Error responses": an empty `locals.tokens` silently
degrades every SPL transfer to an unlabelled row, which reads to the wallet as
a fact. Propagating to the final error middleware logs the incident and
answers 500. Unknown environment is a programming error, rejected before any
network call.

## Decision 4 — Drop the `cross-fetch` override

**Decision**: remove `"cross-fetch": "^3.1.8"` from `package.json#overrides`
after `npm uninstall`, if `npm ls cross-fetch` is empty.

**Rationale**: the override exists only because the registry pins
`cross-fetch@3.0.6` → vulnerable `node-fetch@2.6.1` (GHSA-r683-j2x4-v87g).
`SECURITY.md` lists it under "Already resolved via overrides" — that bullet
must be deleted in the same change.

## Consumers verified

Backend `list()` readers (unchanged shape): `solana-transaction-service.js`,
`solana-rpc-enrichment.js`, `solana-balance-provider.js`,
`solana-transaction-resource.js`, `helius-transaction-resource.js`.

Frontend (`../salmon-wallet-frontend`): the package is absent from every
`package.json`. `/ft/verified` and `/ft/search` readers —
`packages/shared/src/api/services/tokens.ts` (`BackendToken`,
`normalizeBackendTokens`), `packages/shared/src/types/token.ts`
(`TokenMetadata`) — read `address, symbol, name, decimals, logo, tags,
coingeckoId`; none of that path changes.

Incidental (pre-existing, not touched): the three swap screens pass
`networkId: 'solana-devnet'` to `/ft/search`, which is served by mainnet-only
Jupiter.

## Not verified

- Jupiter's numeric rate limits per plan — official docs list endpoints and
  the `x-api-key` header, no numbers. Moot: `jupiter-rate-limiter` unchanged.
- Whether `cache.jup.ag/tokens` is formally deprecated. Answers 200 today
  (66,673,053 bytes); the published deprecation covers Token API V1 on
  `token.jup.ag` (sunset 2025-08-01), not that host.
