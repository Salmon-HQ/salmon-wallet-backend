# Changelog

All notable, user-visible changes to this API are recorded here, newest first. Releases are tag-driven (`prod/vX.Y.Z` from `main`, matching `package.json#version` — see `docs/DEPLOY.md`). Each release entry should list contract-relevant changes: new/changed/removed endpoints, response-shape changes, provider or behavior changes observable by clients.

## Unreleased

- NFT media and metadata URIs no longer point at `ipfs.io` (the public gateway answers 429 with a `Sunset: 21 Sep 2026` header) or `dweb.link`: `ipfs://` URIs and links on those hosts are rewritten to `ipfs.filebase.io`, the gateway the clients already normalise to.

- The bare-RPC history fallback (Triton and Helius both down) reads its legs the same way as the enriched path: the wallet's net change per asset off the parsed result's `preBalances` / `postBalances` and pre/post token balances, one leg per asset, direction from the legs (spec 016). It used to read the first transfer instruction, so a swap read as a send of one side and a fee-only interaction as unknown. The fallback no longer fetches the wallet's token accounts. `action` / `app` stay absent on that path.

- History items carry `action` (`swap`, `nft_sale`, `nft_purchase`, `accounts_closed`, `program_call`; only on `interaction`), `actionMeta` (`{ count }` for closed accounts) and `app` (the name the user knows the program family by — Jupiter, Raydium, Magic Eden, Marinade…; on any type, absent for the platform's own programs): the verb inside an interaction as a stable key the client translates (spec 017). Token accounts closed for their rent (`accounts_closed`) are hidden from the page like spam and counted in `meta.hidden`.

- History legs are the wallet's net balance change per asset (spec 016). `inputs` / `outputs` now come from the ledger's balance changes (`accountData`: lamports per account, raw token deltas per token account with its owner — Helius carries it, the local parser now fills it from `preTokenBalances` / `postTokenBalances`), one leg per asset, instead of one leg per provider transfer: a token that hopped between two accounts of the same wallet leaves no leg, five fee transfers are no rows, rent returned by closed accounts is one SOL input. Direction is read off the legs, never off the provider: outputs only → `send`, inputs only → `receive`, both → `interaction`, nothing moved → `memo` / `interaction` (the wallet signed) / `unknown`; the old rule that forced `send` whenever the wallet was on both sides is gone, and SOL that only came back to a wallet that signed (its own accounts' rent, a refund) is an `interaction`, not a `receive`. A SOL leg riding beside token legs is reported only from 0.005 SOL (two associated-token-account rents); alone it is always reported. Counterparties (`destination` / `source`) name the transfer of that asset with the largest amount; an `interaction`'s legs carry none. Programmable NFTs (`ProgrammableNonFungible*`) are NFT legs like the plain ones. Shape unchanged.

- `broken-build`, a local-stage fixture Powerup the backend always refuses with 502 `provider_program_mismatch`, so the guard is demonstrable on a device.

- History items carry `memo` (the on-chain note, or null); a memo-only transaction is `type: 'memo'` instead of `unknown`.

- `memo` reference Powerup (one SPL Memo instruction) registered as the first transaction-building Powerup, enabled on the `local` stage only, so the generic build path can be exercised end to end.

- Community Powerups (`community-powerups`): `/v1/networks` now carries `powerups: [{ id, enabled, reason? }]` on every network (`[]` when none; `reason` ∈ `region` | `maintenance` | `deprecated`, only when disabled). Added `GET /v1/solana-{env}/powerups/{id}/build`: an **unsigned** transaction for a registered, transaction-building Powerup, in one flat envelope (`salmonFee` always `null` for now) plus `contributor { name, url }` and the Powerup's typed fields; 404 `not_found` for unknown / disabled / read-only ids, 400 `missing_parameter` / `invalid_parameter`, 502 `provider_program_mismatch`, 422 `simulation_failed`, 503 `simulation_unavailable`. No transaction-building Powerup is registered yet, so the route answers 404 for every id today.

- Native SOL is named `Solana` everywhere (history legs, token metadata); the balance already did. The catalog's "Wrapped SOL" no longer leaks into the SOL leg name.

- History: plain SPL transfers carry `source: 'SOLANA_PROGRAM_LIBRARY'` whichever provider enriched them (the local parser said `TOKEN_PROGRAM`). Hop accounts closed within the transaction net out instead of leaving a phantom leg, NFT legs use the same curated image overrides as the NFT list, and token legs carry `symbol`/`name`/`decimals`/`logo` from the catalog + DAS with correctly scaled `amount` (regression from the token-data change: SPL legs were shown with 0 decimals and a truncated mint). Incoming transfers of unverified tokens are hidden from the page unless `includeSpam=true` (`meta.hidden` counts them). Triton stays the history primary on endpoints without `getTransactionsForAddress` by paging through the standard signature + transaction pair (`[TRITON_HISTORY_METHOD_MISSING]`).

- Provider resilience: every upstream call (CoinGecko, the node provider's RPC + DAS, the enrichment provider, Blockdaemon, dapp metadata) now runs through one client that shares a Redis token bucket across Lambda containers, bounds every wait, timeout and retry by a per-request budget (25 s, under the API Gateway cut-off), opens a per-provider/per-environment circuit breaker after repeated failures and emits CloudWatch EMF metrics (`SalmonApi/Providers`). Two new deliberate 503s: `upstream_unavailable` (circuit open) and `request_budget_exhausted` (budget spent before the call); `upstream_rate_limited` is unchanged. Token metadata and price cache reads/writes are batched (one MGET / one MULTI per balance), and the Solana token catalog snapshot is held in Redis (24 h, 48 h stale copy) and rebuilt single-flight, serving the previous snapshot while one container rebuilds or while its provider is down. Catalog `icon` URLs from CoinGecko's CDN are served in the `large` size. New optional env: `REQUEST_BUDGET_MS`, `<PROVIDER>_MAX_RPS`, `BREAKER_DISABLED`, `METRICS_DISABLED`.
- Token data has new sources. `/ft/verified` and `/ft/search` are served from CoinGecko's curated Solana token list (`tags` keeps `verified`, `coingeckoId` is now populated) joined with on-chain metadata from the node provider's DAS API; search is over the catalog (exact symbol first) and a bare mint address not in the catalog still resolves on-chain (unverified). Balance items keep logo/name/symbol for every mint, while USD price and 24h change now come from CoinGecko and are absent (never 0) for unlisted tokens. `tags` is now two-level: `verified` for the top-1000 Solana tokens by market cap, `community` for every other listed token, none for unlisted mints; the balance keeps hiding everything without `verified` unless `includeSpam=true`, and `/ft/verified` is ordered by market cap. Additive field: `attribution { text, url }` on the `solana-mainnet` entry of `/v1/networks` (CoinGecko requires it rendered). Env: `AGGREGATOR_PRICE_URL` / `AGGREGATOR_API_KEY` removed; `COINGECKO_API_URL` added (paid plan → `https://pro-api.coingecko.com`).

## 0.18.0 — 2026-09-14

- **Breaking**: removed the Solana swap surface — `GET /v1/solana-{env}/ft/swap/order` and `POST /v1/solana-{env}/ft/swap/execute` answer the standard 404 envelope. No client calls them: the wallets offer no swap. Both were reachable without authentication, so anyone with the base URL could ask the backend to quote and execute a Jupiter swap against an arbitrary wallet address. The `/ft` surface is read-only — `verified` and `search` list and search tokens and build nothing.
- The stricter per-IP transaction rate limiter covers the Solana NFT routes alone, since the `/ft/swap` prefix it also guarded stops resolving.
- OpenAPI synced with the code: both swap paths and the now-unreferenced `SwapOrder`, `SwapLegToken` and `SwapExecuteResult` schemas are removed. The swap controller, service and resources stay in the repository for whoever rebuilds the feature; nothing reaches them over HTTP.

## 0.17.0 — 2026-09-10

- Solana transaction history: every RPC reader (Triton JSON-RPC and the bare-RPC fallback) now opts into `maxSupportedTransactionVersion: 1`, so pages containing a v1 / 4096-byte transaction (SIMD-0296) are read instead of failing with `-32015`. Response shape unchanged: v1 carries every account inline and `meta.fee` already includes the priority fee. `@solana/web3.js` is pinned to `1.99.0-beta.0` (first 1.x that accepts `version: 1` in a parsed response; read-only, the backend never builds v1).
- Runtime: Lambda moved from `nodejs20.x` (deprecated by AWS on 2026-04-30) to `nodejs24.x`. No observable API changes.
- Hardening, no observable API changes: caller-supplied path segments are encoded before reaching the CoinGecko URL; `?include=` refuses `__proto__` / `constructor` / `prototype`; the transaction parser tolerates null RPC entries (found by the new property-based suites). NFT burn/transfer domain errors now render through the shared error middleware (same status, code and message as before).
- Dependency maintenance: js-yaml 5.4.1 (merge-key CPU limit), digital-asset-standard-api 2.1.1, jest 30.5.

## 0.16.0 — 2026-09-03

- **Breaking**: removed the cross-chain Bridge surface — every `/v1/bridge/*` endpoint now answers the standard 404 envelope. The flow routed user funds through a centralized exchange, which the published Terms no longer offer; the wallet ships without a Bridge tab.
- **Breaking**: removed `POST /v1/bitcoin-{env}/account/{address}/transactions` (signed-transaction broadcast relay). The wallet broadcasts its signed Bitcoin transaction directly to a public endpoint; the backend never receives signed bytes. The Bitcoin slice is now read-only (history + UTXO).
- Solana balance: when the Blockdaemon lookup fails on transport or an upstream 5xx, the multichain balance endpoint now falls back to the bare RPC (native + Token + Token-2022 aggregated per mint, same item shape). An upstream 4xx still propagates; a failing fallback still propagates — never an empty balance.
- Dependency and security maintenance: redis 5→6, js-yaml 4→5, axios 1.20, mpl-bubblegum 5.1, transitive overrides to clear the npm audit and license blockers. No observable API changes.

## 0.15.2 — 2026-08-26

- Bridge: migrated the bridge provider's API from v2 to v4. Added `POST /v1/bridge/exchange` (creates the exchange server-side so a retried request cannot open duplicate orders) and an optional refund address forwarded to the provider.
- Bitcoin: transaction responses emit the UTXO field names the wallet reads.
- NFT listing: ownership check before building a print-edition burn, malformed metadata URLs no longer fail the whole listing, exposes `creators` and real `collection.verified`, weighted spam score with corroborating signals, per-page hidden counts in pagination, and a `?debug=1` flag.
- Errors: every endpoint reports what actually failed; transport failures no longer echo provider addresses.
- Rate limiting: the per-IP limit is enforced in production.
- Outbound connections get more than 250ms to complete; security hardening (rate-limit coverage, address validation, SSRF pinning, dependency updates).
- OpenAPI synced with the code: bridge status enum, `/transaction` 404, `noCache`.

## 0.15.1 — 2026-08-13

- No API changes. Renames the scheduled-job EventBridge rules (`listTokensJobBtc-*`, `refreshPricesJobBtc-*`): removing the Solana schedules in 0.15.0 shifted the named BTC rules to new CloudFormation logical IDs, and create-before-delete collided with the existing rule names, failing the `prod/v0.15.0` deploy (stack rolled back cleanly; 0.15.0 never went live — its changes ship with this tag).

## 0.15.0 — 2026-08-12

- Added `GET /v1/chart/{platform}/contract/{address}`: market chart by token contract address (mint), so SPL tokens whose metadata lacks a CoinGecko id can still chart. 404 `chart_not_found` for unlisted contracts.
- Added `GET /v1/coin/{platform}/contract/{address}`: coin detail (Info/About sections — market cap, rank, ATH/ATL, supply, volume, description) by token contract address, same response shape as `/v1/coin/{coinId}` including the resolved CoinGecko `id` so clients can cache it and switch to the coin-id paths. 404 `info_not_found` for unlisted contracts.
- Runtime dependency updates (@solana/web3.js 1.98, @solana/spl-token 0.4.15, umi 1.5, express 5.2, bs58 6 — behavior preserved, covered by a new base58 regression test) and removal of three unused runtime dependencies. No observable API changes.

- `GET /v1/bridge/minimal` now resolves the pair minimum from the provider's fee _range_ endpoint — the previous upstream endpoint is deprecated upstream — and additionally returns `max_amount` when the pair has an upstream cap (additive; `min_amount` unchanged).
- **Breaking / bug fix**: `GET /v1/bridge/exchange` and `GET /v1/bridge/transaction` now return the camelCase public shape (`payinAddress`, `amountExpectedTo`, …) instead of the raw snake_case provider payload. This fixes bridge-exchange creation: the wallet reads `payinAddress` as the deposit address, which previously arrived undefined.

- **Breaking**: removed `GET /v1/solana-{env}/ft/batch` (batch token lookup) — no consumers in the current frontend and near-zero traffic in 30 days of prod. `/ft/verified` and `/ft/search` are unchanged; the internal batch lookup still backs balances.
- **Breaking**: removed `GET /v1/solana-{env}/ft` (full token list) — zero traffic in 30 days of prod and no consumers in the current frontend. `/ft/verified` and `/ft/search` are unchanged.
- **Breaking**: removed `GET /v1/solana-{env}/ft/price/:mintAddress` and `GET /v1/solana-{env}/ft/price/batch` — zero traffic in 30 days of prod and no consumers in the current frontend.
- **Breaking**: removed `GET /v1/coins` and `GET /v1/coins/:platform` — zero traffic in 30 days of prod and no consumers in the current frontend. `/v1/exchange-rates`, `/v1/chart/:coinId`, `/v1/coin/:coinId` are unchanged.
- Removed the Solana schedules of the CoinGecko `listTokensJob` and `refreshPricesJob` — their output (`solana:tokens_list` / `solana:tokens_prices`) only fed the removed `/v1/coins` surface. The Bitcoin schedules stay (they feed BTC balance pricing).
- Removed the scheduled Solana token-refresh Lambda (it populated a cache no code read; no observable behavior change).
- Added open-source scaffolding: `LICENSE`, `NOTICE`, `SECURITY.md`, `CONTRIBUTING.md`, this changelog, and an OpenAPI reference (`docs/openapi.yaml`).
- Relicensed from ISC to Apache-2.0.
- Removed the unused `SYNDICA_API_KEY` configuration (no code read it).
- **Breaking**: removed `GET /v1/solana-{env}/nft/{mintAddress}` (single NFT detail) — no consumers in the current frontend and near-zero traffic in 30 days of prod. The NFT owner list (`GET /nft`), burn (`POST /nft/{mintAddress}`), and transfer (`POST /nft/{mintAddress}/transfer`) endpoints are unchanged.
- **Breaking**: removed `GET /v1/solana-{env}/account/{address}/transactions/{signature}` (single enriched tx detail) — no consumers in the current frontend and near-zero traffic in 30 days of prod. The transaction history endpoint and its enrichment/fallback policy are unchanged.
- **Breaking**: removed `GET /v1/bitcoin-{env}/account/{address}/transactions/{id}` (single tx detail) — no consumers in the current frontend and near-zero traffic in 30 days of prod. Transaction history, UTXO, and broadcast endpoints are unchanged.
- **Breaking**: removed the Bitcoin raw JSON-RPC pass-through (`/v1/bitcoin-{env}/rpc`, any method) — no consumers in the current frontend and near-zero traffic in 30 days of prod. Account history, UTXO, and broadcast endpoints are unchanged.
- `GET /ip` now returns the standard `{ error, error_description }` envelope on failure instead of a raw upstream error object.
- Internal refactors with no contract change: spam-filter decision centralized in the NFT service, transaction resources made I/O-free, `shared/` folders for cross-chain controllers/routes.

## 0.14.0 — 2026-08

Baseline entry; history before this point lives in the git log (`git log --oneline`). Notable state at 0.14.0:

- Health endpoint reports `DOWN` with a 500 when a probe fails.
- Hardened analytics version validation; GA4 sink for `POST /v1/events`.
- MySQL/Twitter waitlist surface fully removed; Redis is the only data store.
