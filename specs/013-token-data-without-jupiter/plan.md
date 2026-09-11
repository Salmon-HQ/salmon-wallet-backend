# Implementation Plan: Token data without Jupiter

**Branch**: `013-token-data-without-jupiter` (stacked on `feat/swap-0x-signing-boundary`) | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

## Summary

Two sources replace Jupiter behind unchanged public shapes: Triton DAS
(`getAssetBatch` + `showFungible`) for per-mint metadata and Token-2022
extensions, CoinGecko (Solana token list + `simple/token_price/solana` +
`coins/list?include_platform`) for the curated catalog, `coingeckoId`, USD
price and 24h change. Search becomes a local index over the catalog
snapshot with a DAS lookup for bare mint addresses. Every Jupiter module,
variable and dependency is deleted.

## Technical Context

Node 24 CJS, Express 5, Jest 30, axios, Redis (`cache-helper`). Reused:
`triton-client.getRpcUrl` (DAS over the paid RPC URL), `coingecko-rate-limiter`

- `coingecko-service.fetchFromCoinGecko` pattern, `price-cache` (5 min TTL),
  `solana-ft-repository` (verified snapshot), `solana-ft-batch-resource`
  (public token shape), `SOL_*` constants for native SOL (DAS answers `null`
  for the WSOL mint). Probed 2026-09-11 on our Triton endpoint: symbol/name
  under `content.metadata`, decimals/`token_program` under `token_info`, logo
  under `content.links.image`, extensions under `mint_extensions`
  (`transfer_fee_config.newer_transfer_fee.transfer_fee_basis_points`,
  `transfer_hook.program_id`, `non_transferable`).

## Constitution Check (AGENTS.md)

| Gate                                | Status                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Preserve public contracts           | PASS — shapes unchanged; `swappable`, populated `coingeckoId`, `attribution` are additive                                             |
| Never 200 with degraded payload     | PASS — catalog miss + source down → error; prices are decoration (absent, never 0)                                                    |
| Chain-specific code under `solana/` | PASS — metadata + catalog services live in `services/solana`; price stays in `services/shared/coingecko-service` (cross-chain client) |
| Tests at the nearest layer          | PASS — unit per service with recorded fixtures; one nightly integration on Triton + CoinGecko                                         |
| Dependencies                        | PASS — removes `@jup-ag/api`; adds none                                                                                               |
| Secrets                             | PASS — `COINGECKO_API_KEY` already an SSM param; Jupiter params deleted after merge                                                   |

## Design

```
src/services/solana/
├── token-metadata-service.js      # NEW: Triton DAS getAssetBatch (≤1000 ids, showFungible) → canonical token; per-mint Redis cache 1h; SOL short-circuit; `swappable` from extensions
├── token-catalog-service.js       # NEW: CoinGecko Solana list + coins/list(include_platform) → catalog snapshot (Redis ≤24h, in-memory index); verified(), search(query) (symbol/name/mint, exact symbol first), byMint()
├── solana-ft-service.js           # getVerified → catalog; search → catalog, then DAS for a bare mint; getByMints → catalog ⊕ DAS merge; list()/devnet registry unchanged
└── (deleted) jupiter-service.js, jupiter-token-service.js, cdn-token-list-service.js
src/services/shared/coingecko-service.js   # + getTokenPrices(platform, addresses) → Map mint → { usdPrice, priceChange24h }, chunked ≤515, via price-cache
src/services/multichain/price-enrichers/solana-price-enricher.js  # → coingecko getTokenPrices
src/services/solana/swap/solana-swap-build-service.js             # + routability check (422 token_not_supported) before 0x; decimals from metadata
src/resources/solana/solana-swap-build-resource.js                # → ft-service.getByMints + coingecko prices
src/resources/solana/solana-ft-batch-resource.js                  # + swappable (default true)
src/services/shared/network-catalog-service.js + resource         # + attribution { text, url }
src/infrastructure/rate-limiting/jupiter-rate-limiter.js          # deleted
```

Canonical token (internal, provider-agnostic; readers keep using
`id||address`, `icon||logoURI`, `tags`, `decimals`):

```js
{ id, symbol, name, decimals, icon, tags: ['verified'] | [], coingeckoId: string|null,
  tokenProgram: 'spl-token' | 'token-2022' | null, swappable: boolean }
```

Routability: `swappable = false` when `transfer_fee_config` has
`transfer_fee_basis_points > 0`, `transfer_hook.program_id` is set, or
`non_transferable` is present (0x's documented rule).

Catalog snapshot: `{ tokens: [...canonical], byMint, byId, builtAt }` cached
24h in Redis under the existing `solana_ft_verified` key family; the
in-memory index is rebuilt per Lambda container from the snapshot. Search
ranks: exact symbol → symbol prefix → name/symbol substring → mint equality.

Errors: catalog source down and no snapshot → 503 `token_catalog_unavailable`
(never an empty list); metadata source down → balance served unfiltered
(existing behaviour); prices down → USD fields absent.

Config: `COINGECKO_API_KEY` (paid plan for prod), `TRITON_RPC_URL`
(existing). Removed: `JUPITER_PRICE_URL`, `JUPITER_API_KEY` (code, config,
`.env.example`, SSM script, nightly workflow, jest.setup dummies).

## Test plan

- `token-metadata-service.spec.js`: DAS fixtures for USDC (SPL), PYUSD
  (Token-2022, routable), BERN (transfer fee → not swappable), null asset,
  SOL short-circuit, batching > 1000, cache hit/miss.
- `token-catalog-service.spec.js`: list + coins/list fixtures → snapshot;
  verified(); search ranking; mint lookup; source down with/without snapshot.
- `coingecko-service.spec.js`: getTokenPrices chunking, absent mints, cache.
- `solana-ft-service.spec.js`, `solana-price-enricher.spec.js`,
  `solana-balance-provider.spec.js`, swap build/resource specs: rewired
  mocks; `search` by bare mint via DAS.
- Boundary: `grep -rin jupiter src config .env.example docs/openapi.yaml`
  limited to parser/program ids (asserted by a small spec).
- Nightly `token-data.integration.spec.js`: real Triton + CoinGecko for
  USDC/SOL/BERN; probe-skips without keys.

## Rollout

Ships with the 0x branch. Before the prod tag: CoinGecko Basic key in SSM;
after merge: delete `JUPITER_*` SSM params + GitHub secrets. Frontend:
render attribution, honour `swappable` (spec 027 branch).
