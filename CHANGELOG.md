# Changelog

All notable, user-visible changes to this API are recorded here, newest first. Releases are tag-driven (`prod/vX.Y.Z` from `main`, matching `package.json#version` — see `docs/DEPLOY.md`). Each release entry should list contract-relevant changes: new/changed/removed endpoints, response-shape changes, provider or behavior changes observable by clients.

## Unreleased

- **Breaking**: removed the cross-chain Bridge surface — every `/v1/bridge/*` endpoint now answers the standard 404 envelope. The flow routed user funds through a centralized exchange, which the published Terms no longer offer; the wallet ships without a Bridge tab.
- **Breaking**: removed `POST /v1/bitcoin-{env}/account/{address}/transactions` (signed-transaction broadcast relay). The wallet broadcasts its signed Bitcoin transaction directly to a public endpoint; the backend never receives signed bytes. The Bitcoin slice is now read-only (history + UTXO).

## 0.15.2 — 2026-08-26

- Bridge: migrated the bridge provider's API from v2 to v4. Added `POST /v1/bridge/exchange` (creates the exchange server-side so a retried request cannot open duplicate orders) and an optional refund address forwarded to the provider.
- Swap: order fee is now denominated in the input token (previously mislabeled as SOL for non-SOL inputs); the service also detects when Jupiter drops the referral fee. Removed the unused `slippage` parameter from the swap order service.
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
- **Breaking**: removed `GET /v1/solana-{env}/ft/price/:mintAddress` and `GET /v1/solana-{env}/ft/price/batch` — zero traffic in 30 days of prod and no consumers in the current frontend. Swap orders still resolve Jupiter prices server-side.
- **Breaking**: removed `GET /v1/coins` and `GET /v1/coins/:platform` — zero traffic in 30 days of prod and no consumers in the current frontend. `/v1/exchange-rates`, `/v1/chart/:coinId`, `/v1/coin/:coinId` are unchanged.
- Removed the Solana schedules of the CoinGecko `listTokensJob` and `refreshPricesJob` — their output (`solana:tokens_list` / `solana:tokens_prices`) only fed the removed `/v1/coins` surface. The Bitcoin schedules stay (they feed BTC balance pricing).
- Removed the `refreshJupiterTokensJob` scheduled Lambda (it populated a cache no code read; no observable behavior change).
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
