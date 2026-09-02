# AGENTS.md instructions for salmon-api

Canonical rules for any AI agent or assistant working in this repo, regardless
of tool or vendor. Tool-specific files (`CLAUDE.md`, `.claude/`, `.codex/`)
only point back here — if they ever disagree with this file, this file wins.

## How to work here

- **Guidance is layered so you only load what you need**: this file holds the
  rules; each `src/*` folder has a nested `AGENTS.md` with folder-level detail
  (the closest one wins for its folder); `docs/` holds deep dives
  (`ARCHITECTURE.md`, `TESTING.md`, `DEPLOY.md`); skills under `.claude/skills/`
  and `.codex/skills/` hold on-demand workflows.
- **When in doubt, ask the human.** If placement, ownership, change scope, or
  contract impact is still genuinely ambiguous after reading the relevant
  `AGENTS.md` and docs, ask instead of guessing — a wrong guess on a public
  contract or folder boundary is expensive to unwind; a question is cheap.
- **Prefer a code graph if one is available.** If your environment exposes a
  code-graph / semantic-search / impact-analysis tool for this repo (e.g. a
  `.code-review-graph/graph.db` exists, or the harness provides an equivalent),
  use it for exploration and blast-radius checks — it is cheaper and more
  accurate than scanning files. Always verify findings against the actual
  source before acting; fall back to grep/glob/read when no such tool exists
  (a fork may not have one).

## Repo shape

This repo is a layered Express/Serverless backend organized as vertical slices per blockchain (`bitcoin/`, `solana/`, `ethereum/` skeleton), a `multichain/` slice for cross-chain endpoints (e.g. balance dispatch), and a `shared/` slice for cross-domain services that have no chain affinity.

`src/index.js` mounts each chain's routes via a loop over the `BLOCKCHAINS` constant, gated per mount by `multinetwork({ blockchains: [chain] })`. Adding a chain = append the constant + provide `src/routes/<chain>/index.js`. See the "Adding a new blockchain" section in `docs/ARCHITECTURE.md`.

Main flow:

- `src/routes` wires paths and middlewares
- `src/controllers` translates HTTP input/output
- `src/services` owns business flow and orchestration
- `src/repositories` and `src/infrastructure` talk to data sources or external providers
- `src/resources` shapes public API payloads

Reference doc:

- `docs/ARCHITECTURE.md` explains folder responsibilities in more detail

## Placement rules

One job per layer. This is what keeps changes local, providers swappable, and
tests targeted — logic that leaks across layers couples chain slices together
and turns small edits into cross-cutting ones.

- Put new HTTP wiring in `routes`, not `controllers`.
- Keep controllers thin. If a controller starts coordinating providers or fallbacks, move that logic to a service.
- Put cross-provider orchestration, caching policy, and fallback policy in `services`.
- Put data access and source adapters in `repositories` unless the code is a shared technical client, in which case use `infrastructure`.
- Put response shaping and stable public payload mapping in `resources` — the resource layer is the public contract, so shape drift stays reviewable in one place.
- Keep `utils` for genuinely cross-domain helpers only. If a helper is Solana-only, keep it close to `src/*/solana` — chain-specific code in generic folders hides its real owner and blocks clean chain removal.

## Domain rules

- Solana-specific code belongs under the matching `src/{routes,controllers,services,repositories,resources}/solana` folder.
- Bitcoin-specific code belongs under the matching `src/{routes,controllers,services,resources}/bitcoin` folder.
- Ethereum is scaffolded but not active. Folders exist with AGENTS.md only; the router at `src/routes/ethereum/index.js` is empty so the chain-mount loop boots cleanly. Networks `ethereum-mainnet` / `ethereum-sepolia` are present in `src/constants/networks.js` but absent from every `network-capabilities-${stage}.enable` list, so the FE does not surface Ethereum.
- Cross-chain endpoints that dispatch on `locals.network.blockchain` (e.g. account balance) live under `src/{routes,controllers,services}/multichain`. The supported chains for each multichain endpoint are an explicit allowlist (e.g. `BALANCE_CHAINS` in `src/routes/multichain/account-router.js`) — adding a chain requires editing that allowlist. Cross-chain response shapes live under `src/resources/shared` (e.g. `account-balance-resource.js`); there is no `src/resources/multichain` because shapes do not need a dispatch layer.
- Cross-domain services with no chain affinity (coingecko, dapp, geo, network-catalog, network-capabilities, scam, trustwallet) live under `src/services/shared`. Their persistence partners live under `src/repositories/shared` and their public response shapes under `src/resources/shared`.
- Preserve public endpoint contracts unless the task explicitly allows breaking changes — deployed wallet clients parse these payloads, and a renamed field breaks them silently with no compile-time signal.
- Before removing backend surface, check active usage in the sibling frontend repo `../salmon-wallet-frontend` (when present) — it is the primary consumer, and searching it is the only reliable usage signal for an endpoint.
- Ethereum-related placeholders are intentional future surface, not dead code. Do not remove them unless the task explicitly asks for it.
- Triton One is the primary provider for enriched Solana transaction data when `TRITON_RPC_URL` is configured; Helius Enhanced API is the rate-limited fallback. The provider resolver in `src/services/solana/providers` routes between them. The bare-RPC path (via `locals.network.config.nodeUrl`) must remain functional when both providers are unavailable.

## Error responses

- Error payloads use the envelope `{ error: '<snake_case_code>', error_description: '<human message>' }` with a meaningful HTTP status (e.g. `bad_request` 400, `nft_not_found` 404, `server_error` 500). The catch-all 404 and the final error middleware in `src/index.js` emit the same shape, so clients parse one error format everywhere — keep new endpoints on it.
- Reserve `500 server_error` for our own faults. Caller input is validated before the upstream call (400 `missing_parameter` / `invalid_parameter` / `bad_request`), our own back-pressure is 503 `upstream_rate_limited`, and an outcome we genuinely cannot determine says so (e.g. 502 `broadcast_status_unknown`) rather than claiming failure.
- Never answer 200 with an empty or degraded payload when the truth is that a provider failed. An empty balance, an empty NFT list or a catalog with everything disabled all read to the wallet as facts about the user's account. Let the failure surface.
- Upstream providers (Jupiter, Blockdaemon, RPC nodes) reject bad caller input with their own 4xx. `src/middlewares/error-handler.js` maps upstream 400/404/422 onto `bad_request`/`not_found`/`unprocessable_entity` and leaves every other upstream status as 500 — an upstream 401/429/5xx is our credentials or the provider being down, which the caller cannot act on. Do not re-map these per controller.
- Do not swallow unexpected errors in controllers — let them reach the final error middleware, which logs and responds 500 (or the mapped 4xx above). A silent catch hides the incident from logs and from the client. Deliberate upstream pass-throughs (e.g. Bitcoin broadcast) are documented in that slice's `AGENTS.md`.

## Testing rules

- Any new behavior should come with tests at the nearest meaningful layer.
- Before changing sensitive behavior, establish a small baseline test when practical.
- After changing behavior, rerun the targeted backend tests for the touched area.
- If the touched endpoint is consumed by `../salmon-wallet-frontend`, verify the most relevant frontend client or tests too.
- Prefer service/resource/controller tests over broad full-suite runs unless the change radius requires more.

### Unit vs integration naming (enforced by CI)

- All specs match `*.spec.js` (jest `testRegex`).
- A suite that hits real services (Redis, live provider APIs) MUST be named
  `*.integration.spec.js`. `npm run test:unit` excludes that pattern, and CI's
  `verify` job runs `test:unit` with no `.env`, no services, and no secrets —
  a misnamed integration suite either fails CI or, worse, silently makes CI
  depend on external services.
- `jest.setup.js` loads `.env` when present and injects dummy values for env
  vars that some modules require at import time (e.g. `HELIUS_API_KEY`), so
  unit tests run hermetically. If a new module throws at import when an env
  var is missing, add a dummy there instead of making unit tests need a real
  `.env`.
- `npm run test:integration` runs `--runInBand` and needs a real `.env`.
- Full guide: `docs/TESTING.md`.

## Tooling

- Package manager: **npm**. `package-lock.json` is authoritative; install with `npm ci`. Do not add pnpm/yarn lockfiles — CI and the deploy workflow run npm, so a second lockfile silently drifts from what actually ships. (The sibling `../salmon-wallet-frontend` repo is a pnpm monorepo; that convention is that repo's, not this one's.)
- Runtime is Node 20 (`nodejs20.x` in `serverless.yml`). Develop and test on Node 20 — `package.json#engines` enforces a `>=20` floor.
- Lint: `npm run linter` (ESLint with auto-fix) fixes locally; the PR gate runs `npm run lint:check` (zero warnings) — run it before finishing.
- Format: Prettier is enforced in CI (`npm run format:check`). Fix with `npm run format`.
- Every PR runs the deterministic gate in `.github/workflows/ci.yml` (format, lint, unit tests, serverless config smoke, hermetic Redis integration, conventional PR title, zizmor). Live-provider integration suites run in the nightly `integration-external.yml`, never in the PR gate.

## Dependencies

- This backend serves a wallet, so every dependency is supply-chain attack surface plus Lambda cold-start weight. Prefer, in order: existing code in the repo (`src/utils`, `src/infrastructure`, `packages/`), the Node stdlib, an already-installed dependency, and only then a new package — and justify any new package in the change description.
- Do not remove a dependency just because it looks unused without checking intent — some are kept deliberately for future surface (e.g. Ethereum). If intent is unclear, ask the human.

## Secrets

- Never commit secrets — not in code, config YAML, or docs. Prod secrets live only in AWS SSM Parameter Store (`/salmon-api/prod/*`); this keeps rotation out of git history and off forks. Every prod var in `config/env.prod.yml` is an `${ssm:...}` ref; six of them (`COINGECKO_API_KEY`, `SOLANA_FALLBACK_MAX_RPS`, `TRITON_RPC_URL`, `TRITON_RPC_URL_DEVNET`, `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`) carry an empty-string fallback, so a missing parameter deploys as unset rather than failing the deploy — check SSM, not the deploy log, when one of those features is silently off in prod.
- `.env` is gitignored, development-only, and intentionally diverges from prod (dev-safe values limit blast radius). Never treat it as a source of truth for prod values. Rotation flow: `docs/DEPLOY.md`.

## Deploy (pointer only)

Prod deploys are tag-triggered: push `prod/vX.Y.Z` from `main` → CI runs a
credential-free `verify` job (lint + `test:unit` + config sanity check), then
deploys via GitHub OIDC. Prod secrets live in AWS SSM Parameter Store, never
in the repo. Do not duplicate this flow elsewhere — details and quirks live in
`docs/DEPLOY.md` and `.claude/skills/deploy-runbook/SKILL.md`. Read them
before touching `serverless.yml`, env vars, or CI workflow files.

## Repo-specific hotspots

- `src/services/solana` is the highest-risk area. Keep changes focused and backed by tests.
- For Metaplex/NFT work (burn, transfer, Bubblegum, DAS), agents can install the official Metaplex skill: `npx skills add metaplex-foundation/skill`.
- For Jupiter Price/Swap work, agents can install the official Jupiter skill: `npx skills add jup-ag/agent-skills`.
- For Helius RPC/DAS work, see the official Helius AI tooling repo: `https://github.com/helius-labs/core-ai`.
- `src/resources/solana` defines transaction and asset response shapes consumed by clients. Be careful with field names and structures.
- `packages/` contains internal shared utilities. Do not move feature code there unless it is truly cross-cutting — code in `packages/` escapes the chain-slice ownership model and is harder to trace back to a domain.

## Documentation rules

- Put durable repo docs in `docs/`.
- Keep docs responsibility-oriented. Prefer folder/module responsibilities over file-by-file inventories unless the task explicitly asks for file-level documentation.

## API contracts

These are the public-facing API contracts and their invariants. Changing the
behavior of any documented capability is a contract change — treat it as such
(check consumers, cover with tests, review):

- `solana-transaction-enrichment` — tx history shape, `_source` enum, provider routing + fallback policy
- `solana-source-catalog` — program-ID → source-name map, priority bands, source-add convention
- `solana-fungible-token-catalog` — `/ft/verified`, `/ft/search` shapes + fungibility filter
- `solana-swap-orchestration` — Jupiter Ultra `/order` + `/execute` shapes; 404 on no-route / failed-execution (the provider's own reason travels in `error_description`, because the wallet classifies swap failures by matching that text); server-side referral. `input.amount` and `fee` come from the order's top-level `inAmount`, never from `routePlan[0]`, which is only the first leg.
- `solana-nft-listing` — `/nft` owner-list flat backend shape; empty array when the owner has no NFTs; token-standard filtering. `pagination.hidden = { spam, fungible }` counts the items dropped from that page only (not cumulative): `spam` is what the blacklist / spam score hid (`0` when `includeSpam` is on), `fungible` is the DAS assets the resource rejected as fungible. `pagination.total` stays the provider's raw count, so a page can carry fewer than `limit` items; the Helius DAS path fetches `page: 1, limit: 1000` (`src/services/solana/providers/helius-provider.js`), so `total` tops out at 1000 there. Spam hiding is a weighted score: each `spamReasons` code has a weight (table in the header of `src/services/solana/nft-spam-detector.js`), `spamScore` is their sum, and an item is dropped from the default listing when `spamScore >= SPAM_THRESHOLD` (2) — strong reasons hide alone, weak ones only in pairs. `duplicate_name` is wallet-level (the listing service counts names per page onto `locals`). The healthy-wallet fixtures under `src/services/solana/__tests__/fixtures/` pin that no legitimate NFT is newly hidden; re-tune against them, not by intuition
- `solana-nft-burn` — token-standard routing (cNFT v1/v2, pNFT, edition, master); cNFT lookup-table fallback shape; error envelope. Fungible mints are refused (422) before any builder runs: `edition.isOriginal` derives from `supply.edition_nonce`, which is set on plenty of non-NFT mints, so decimals decide fungibility.
- `multichain-account-balance` — array-shape balance response with native/token branching for Bitcoin + Solana. Solana: Blockdaemon Universal is primary (6 s budget); on a transport error or upstream 5xx `solana-balance-provider` falls back to the bare RPC (`solana-rpc-balance-provider`, native + Token + Token-2022 aggregated per mint, same item shape). An upstream 4xx propagates and never triggers the fallback; a fallback failure propagates too — never an empty balance.
- `bitcoin-account-history` — canonical 9-bucket tx shape, fee attribution, full-set UTXO walk (bounded at 100 pages, then 422 `utxo_set_too_large`). `/utxo` items carry both the shipped `txId`/`outputIndex` and the `txid`/`vout` aliases the wallet's PSBT builder reads; records that cannot describe a spendable output are dropped rather than emitted with undefined fields. **Sending BTC does not work end to end yet**: the wallet derives P2PKH addresses (`m/44'/0'`), and a PSBT spending a P2PKH input needs `nonWitnessUtxo`, i.e. the full raw previous transaction. Blockdaemon's Universal API does not expose raw hex (probed: no `/tx/{id}/raw`, no native JSON-RPC on this plan), so closing this needs a decision — a second data source for raw transactions, or moving the wallet to segwit/taproot addresses, where the `script` + `satoshis` we already return are enough via `witnessUtxo`. A broadcast whose outcome cannot be confirmed (local abort, provider 5xx) answers 502 `broadcast_status_unknown` instead of a flat failure, because the transaction may already be relayed.
- `network-catalog` — `/v1/networks` shape, stage-derived `enabled` + `sections`. A misconfigured stage answers 503 `network_catalog_unavailable`, never a 200 whose networks are all disabled.
- `coingecko-market-data` — `/exchange-rates`, `/chart/:coinId`, `/chart/:platform/contract/:address` (chart by mint, 404 `chart_not_found` when unlisted), `/coin/:id`, `/coin/:platform/contract/:address` (coin info by mint, same shape as `/coin/:id` incl. resolved `id`, 404 `info_not_found` when unlisted) shapes; long-term-fallback policy; `days` normalization
- `dapp-metadata` — OpenGraph-derived `{ name, icon }` shape. The URL is fetched through the SSRF guard in `src/services/shared/dapp-url-guard.js` (public addresses only, re-validated per redirect, bounded in time and size); `icon` is dropped unless it is absolute https and `name` is length-capped, because both are attacker-controlled text rendered next to a signing prompt.

Small refactors that preserve behavior are fine; behavior changes that alter
any contract above must be deliberate and covered by tests.

Internal contracts (not externally observable, kept here for the same
reason):

- `BLOCKCHAINS` registry in `src/constants/blockchains.js` — drives the chain-mount loop in `src/index.js`. Every entry MUST have a matching `src/routes/<chain>/index.js` (asserted by `src/constants/__tests__/blockchains.spec.js`).
- `BalanceProvider` interface in `src/services/multichain/balance-providers/balance-provider.js` — the plug-point for per-chain balance providers. The default `blockdaemon-balance-provider.js` covers any Blockdaemon-supported chain. Chain-specific overrides register in `src/services/multichain/balance-providers/index.js#PROVIDERS_BY_CHAIN`.
- `SolanaDataProvider` interface in `src/services/solana/providers/solana-data-provider.js` — the plug-point for adding new Solana data providers. JSDoc-documented.
- `withCachedTransactionHistory` in `src/infrastructure/cache/transaction-history-cache.js` — first-page-only caching policy used by `solana-account-controller` (Solana) and `bitcoin-transaction-service` (Bitcoin).
- Scheduled jobs in `src/jobs/handler.js` — CoinGecko token-list refresh (hourly, bitcoin) and price refresh (hourly, bitcoin; rate-limited at 200 tokens/run) feeding `bitcoin:tokens_prices` for the Bitcoin balance enricher.
