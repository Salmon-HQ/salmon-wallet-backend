# Implementation Plan: Replace the archived SPL Token Registry

**Branch**: `005-replace-spl-token-registry` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-replace-spl-token-registry/spec.md`

## Summary

`@solana/spl-token-registry` survives in exactly one branch of one function:
the devnet/testnet fallback of `getTokenList()` in
`src/services/solana/solana-ft-service.js:71-75`. The package is a build-time
snapshot of the JSON that `src/services/solana/cdn-token-list-service.js`
already downloads from jsDelivr for the `/ft/verified` fallback. Plan: add a
cluster-filtered raw fetch to that existing service, point the devnet/testnet
branch at it, delete the package and the `cross-fetch` override that existed
only for it. No public contract or frontend change.

## Technical Context

**Language/Version**: Node 20 (CommonJS), Express 5 on AWS Lambda via `serverless-http`

**Primary Dependencies**: `axios` (already used by `cdn-token-list-service`); removes `@solana/spl-token-registry`

**Storage**: none new — existing in-memory `tokenListCache` (1 h TTL) + `pendingTokenLoads` in `solana-ft-service`

**Testing**: Jest 30 — `npm run test:unit` (hermetic), `*.integration.spec.js` for live-provider checks (nightly `integration-external.yml`)

**Target Platform**: AWS Lambda `nodejs20.x`, us-east-1

**Project Type**: web-service (single backend repo)

**Performance Goals**: no regression — the CDN file is ~6 MB, fetched at most once per environment per Lambda instance per hour (same as the package's own resolve, which fetched nothing but shipped the same bytes in the bundle)

**Constraints**: AGENTS.md error rules — never answer 200 with a degraded/empty token list; failures propagate to the final error middleware. `*.integration.spec.js` naming is enforced by CI.

**Scale/Scope**: 2 source files, 2 unit spec files extended, 1 new integration spec, `package.json` + lockfile, 2 prose updates

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

`.specify/memory/constitution.md` is the unfilled template; `AGENTS.md` is the
binding rule source for this repo. Gates derived from it:

| Gate                                                            | Status                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Placement — services own orchestration, no logic in controllers | PASS — change is confined to `src/services/solana`                                             |
| Public contracts preserved (`solana-fungible-token-catalog`)    | PASS — `/ft/verified` and `/ft/search` do not reach the changed branch                         |
| Never 200 with degraded data                                    | PASS — CDN failure throws; nothing cached on failure                                           |
| Tests at nearest meaningful layer; TDD                          | PASS — unit specs written first, integration spec named per CI rule                            |
| Dependency policy — prefer existing code over new packages      | PASS — zero new packages, one removed                                                          |
| Frontend usage check before removing surface                    | PASS — package absent from every FE `package.json`; FE reads only fields the CDN entry carries |

Post-design re-check: unchanged, all PASS. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/005-replace-spl-token-registry/
├── plan.md              # This file
├── research.md          # Phase 0: source comparison, alternatives
├── data-model.md        # Phase 1: token entry / cluster list shapes
├── quickstart.md        # Phase 1: how to verify locally
├── contracts/           # Phase 1: affected public + internal contracts
│   └── token-lists.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/services/solana/
├── cdn-token-list-service.js          # + getClusterTokens(environment), CLUSTER_CHAIN_IDS
├── solana-ft-service.js               # devnet/testnet branch → cdnTokenListService; drop require
└── __tests__/
    ├── cdn-token-list-service.unit.spec.js          # extend
    ├── cdn-token-list-service.integration.spec.js   # new (nightly only)
    ├── solana-ft-service.spec.js                    # extend
    └── solana-transaction-service.integration.spec.js  # comment at :179 updated

package.json / package-lock.json       # remove @solana/spl-token-registry + cross-fetch override
.claude/skills/service-drift-audit/SKILL.md   # § "@solana/spl-token + spl-token-registry" updated
```

**Structure Decision**: single-project layout already in place; every touched
file is under the Solana slice or repo root. No new folders.

## Design

### `cdn-token-list-service.js`

- Add `CLUSTER_CHAIN_IDS = { mainnet: 101, testnet: 102, devnet: 103 }`.
- Add `getClusterTokens(environment)`:
  - `chainId = CLUSTER_CHAIN_IDS[environment]`; if undefined → `throw new Error(\`Unknown Solana environment: ${environment}\`)` before any network call.
  - `http.get(CDN_TOKEN_LIST_URL, { timeout: CDN_TIMEOUT_MS })` — same URL and timeout as `getVerifiedTokens`.
  - Return `data.tokens.filter(t => t && t.chainId === chainId)` — **raw entries**, not `normalizeCdnEntry` (that mapper targets the Jupiter v2 shape for `/ft/verified`; `list()` readers key on `address` / `logoURI`).
  - No try/catch: a rejected request propagates.
- Export `getClusterTokens` and `CLUSTER_CHAIN_IDS` alongside the existing exports. Update the header comment (it currently says the service is only the `getVerified` fallback).

### `solana-ft-service.js`

- Delete `const { TokenListProvider } = require('@solana/spl-token-registry');`.
- Replace lines 71-75 with `return cdnTokenListService.getClusterTokens(environment);`.
- Update the file header (line 13-14) and the `getTokenList` JSDoc (line 56-58), both of which name the SPL Token Registry.
- `list()`, caching and dedup untouched.

### Dependency cleanup

- `npm uninstall @solana/spl-token-registry`.
- `npm ls cross-fetch` — if empty, remove `"cross-fetch"` from `package.json#overrides` (it exists only because the registry pinned `cross-fetch@3.0.6`). Keep the other overrides.
- `npm audit --omit=dev` must show no new findings (expected: still the single `bigint-buffer` root documented in `SECURITY.md`).

### Failure policy

A CDN failure on the devnet/testnet path rejects `getTokenList` → `list()`'s
inflight promise rejects → nothing is written to `tokenListCache` → the caller
(transaction history / balance enrichment) fails → final error middleware
answers 500 `server_error` (or the mapped 4xx). Next request retries. No
fallback chain is added: there is no second source for devnet data.

## Test plan

Unit first (RED → GREEN), all under `npm run test:unit`, no network:

1. `cdn-token-list-service.unit.spec.js`
   - `getClusterTokens('devnet')` returns only `chainId === 103` entries, raw (`address`, `logoURI`, `extensions` preserved).
   - `getClusterTokens('testnet')` → `chainId === 102`.
   - `getClusterTokens('mainnet')` → `chainId === 101` (documented even though `list()` never calls it for mainnet).
   - `getClusterTokens('nope')` rejects **without** calling `axios.get`.
   - `axios.get` rejection propagates unchanged.
2. `solana-ft-service.spec.js`
   - `list()` with `environment: 'devnet'` calls `cdnTokenListService.getClusterTokens('devnet')` and never `cache.jup.ag`.
   - `list()` with `environment: 'mainnet'` still hits `JUPITER_TOKEN_LIST_URL` (regression guard).
   - CDN rejection on devnet: `list()` rejects, cache stays empty, second call re-invokes the source.
   - Existing 1 h cache + inflight-dedup assertions still pass.

Integration (nightly, `npm run test:integration -- cdn-token-list-service`):

3. `cdn-token-list-service.integration.spec.js` — one live fetch asserting the
   CDN payload still carries `chainId` 101/102/103 with non-zero devnet and
   testnet counts. Named `*.integration.spec.js` so `test:unit` excludes it.

CI gate after implementation: `npm run format:check`, `npm run lint:check`,
`npm run test:unit`, `npx serverless print --stage local`, hermetic redis suite.

## Rollout / rollback

- Single PR to `main`; deploy rides the normal `prod/vX.Y.Z` tag flow (bump `package.json#version` first).
- No migration, no cache invalidation: the in-memory list cache is per-instance and expires in 1 h; the Redis `solana_ft_verified` key is on a different path.
- Rollback = revert + redeploy. Re-adding the package restores the old path exactly (identical data).
- Post-deploy watch: `aws logs tail /aws/lambda/gol-salmon-api-prod-api` for `Loading tokens from source for devnet` followed by a non-zero count; any new 500s on `/v1/solana-devnet/account/*/transactions`.

## Out of scope (tracked, not done here)

- Mainnet `getTokenList()` downloads ~66 MB from `cache.jup.ag/tokens` on every cold cache miss (probed 2026-09-02). Separate feature.
- Fresh devnet/testnet metadata (would require per-mint Helius DAS and turning `locals.tokens` into a resolver).
