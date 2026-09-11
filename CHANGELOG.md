# Changelog

All notable, user-visible changes to this API are recorded here, newest first. Releases are tag-driven (`prod/vX.Y.Z` from `main`, matching `package.json#version` — see `docs/DEPLOY.md`). Each release entry should list contract-relevant changes: new/changed/removed endpoints, response-shape changes, provider or behavior changes observable by clients.

## Unreleased

- History: swaps routed through the 0x settler are classified `swap` with `source: 'AGGREGATOR'` (previously `interaction`), multi-hop routes net the intermediate token out of the legs, the SOL leg of an aggregator swap is the wallet's own balance delta (what it ended up with, not the wrapped-SOL hops), hop accounts closed within the transaction net out instead of leaving a phantom leg, and token legs carry `symbol`/`name`/`decimals`/`logo` from the catalog + DAS with correctly scaled `amount` (regression from the token-data change: SPL legs were shown with 0 decimals and a truncated mint). Incoming transfers of unverified tokens are hidden from the page unless `includeSpam=true` (`meta.hidden` counts them). Triton stays the history primary on endpoints without `getTransactionsForAddress` by paging through the standard signature + transaction pair (`[TRITON_HISTORY_METHOD_MISSING]`).

- Swap build closes the intermediate token accounts a multi-hop route creates for the taker in the same transaction, including the wrapped-SOL account a native-SOL swap opens, refunding their rent (`intermediateAccountsClosed` in the response; `[SWAP_CLEANUP_SKIPPED]` when the simulation rejects the close).

- Provider resilience: every upstream call (CoinGecko, the node provider's RPC + DAS, the enrichment provider, 0x, Blockdaemon, dapp metadata) now runs through one client that shares a Redis token bucket across Lambda containers, bounds every wait, timeout and retry by a per-request budget (25 s, under the API Gateway cut-off), opens a per-provider/per-environment circuit breaker after repeated failures and emits CloudWatch EMF metrics (`SalmonApi/Providers`). Two new deliberate 503s: `upstream_unavailable` (circuit open) and `request_budget_exhausted` (budget spent before the call); `upstream_rate_limited` is unchanged. Token metadata and price cache reads/writes are batched (one MGET / one MULTI per balance), and the Solana token catalog snapshot is held in Redis (24 h, 48 h stale copy) and rebuilt single-flight, serving the previous snapshot while one container rebuilds or while its provider is down. Catalog `icon` URLs from CoinGecko's CDN are served in the `large` size. New optional env: `REQUEST_BUDGET_MS`, `<PROVIDER>_MAX_RPS`, `BREAKER_DISABLED`, `METRICS_DISABLED`.
- **Breaking**: transaction-history `source` (and `swapRoute[].dex`) now reports `AGGREGATOR` for swaps executed through the aggregator router or its limit-order program, on every reader path, replacing the provider's brand label.
- Token data has new sources. `/ft/verified` and `/ft/search` are served from CoinGecko's curated Solana token list (`tags` keeps `verified`, `coingeckoId` is now populated) joined with on-chain metadata from the node provider's DAS API; search is over the catalog (exact symbol first) and a bare mint address not in the catalog still resolves on-chain (unverified). Balance items and the swap review keep logo/name/symbol for every mint, while USD price and 24h change now come from CoinGecko and are absent (never 0) for unlisted tokens. `tags` is now two-level: `verified` for the top-1000 Solana tokens by market cap, `community` for every other listed token, none for unlisted mints; the balance keeps hiding everything without `verified` unless `includeSpam=true`, and `/ft/verified` is ordered by market cap. Additive fields: `swappable` on catalog/search entries (false for Token-2022 mints with a transfer fee or hook, which `/ft/swap/build` now refuses with 422 `token_not_supported` before calling the router) and `attribution { text, url }` on the `solana-mainnet` entry of `/v1/networks` (CoinGecko requires it rendered). Env: `AGGREGATOR_PRICE_URL` / `AGGREGATOR_API_KEY` removed; `COINGECKO_API_URL` added (paid plan → `https://pro-api.coingecko.com`).
- Added `GET /v1/solana-{env}/ft/swap/build` (`solana-swap-build`): builds an **unsigned** swap transaction on the 0x Solana Swap API with Salmon's fee inside, for the wallet to sign and broadcast itself. Response carries `provider` / `providerDisplayName` / `attribution`, `transaction`, `expiresAt`, `input` / `output` (with `minAmount`), `route`, `priceImpactPct`, `slippageBps`, USD values and `salmonFee` (`side: input | output`, whichever Salmon fee account exists; fee-less with an error log when neither does) / `routeFee` objects, and `priorityFeeMicroLamports` / `computeUnitLimit` (network-derived compute-unit price over a simulated compute budget). 0x rejections map by code: 400 `invalid_parameter`, 422 `token_not_supported`, 403 `wallet_restricted`, 404 `no_route`, 500 `swap_misconfigured`. `solana-mainnet` only. Region gating is a follow-up.
- **Breaking**: removed `GET /v1/solana-{env}/ft/swap/order` and `POST /v1/solana-{env}/ft/swap/execute` (the previous routing provider's relay, deprecated upstream). `/execute` was the last endpoint that accepted a signed transaction; the backend now enforces in CI that it never receives signed bytes (signing boundary). `/ft/verified` and `/ft/search` are unchanged. The `exchange` capability section (Bridge, removed in 0.16.0) is gone from `/v1/networks`.

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
- Swap: order fee is now denominated in the input token (previously mislabeled as SOL for non-SOL inputs); the service also detects when the routing provider drops the referral fee. Removed the unused `slippage` parameter from the swap order service.
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

- **Breaking**: removed `GET /v1/solana-{env}/ft/batch` (batch token lookup) — no consumers in the current frontend and near-zero traffic in 30 days of prod. `/ft/verified`, `/ft/search` and the swap endpoints are unchanged; the internal batch lookup still backs balances and swaps.
- **Breaking**: removed `GET /v1/solana-{env}/ft` (full token list) — zero traffic in 30 days of prod and no consumers in the current frontend. `/ft/verified`, `/ft/search` and the swap endpoints are unchanged.
- **Breaking**: removed `GET /v1/solana-{env}/ft/price/:mintAddress` and `GET /v1/solana-{env}/ft/price/batch` — zero traffic in 30 days of prod and no consumers in the current frontend. Swap orders still resolve aggregator prices server-side.
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
