# Tasks: Swap on Jupiter, 0x where Jupiter cannot, offered where it may be offered

**Input**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: test-first on every branch of logic (repo rule); one runnable check per unit; fixtures recorded, never asserted on mocks of the provider's own behaviour.

**Order**: geolocation → screening → swap on 0x behind the gate → Jupiter adapter → config and docs → frontend (its own branch).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Add `@ip-location-db/dbip-country-mmdb` and `mmdb-lib` to `package.json` (npm ci, lockfile), attribution line in `NOTICE` and `AGENTS.md`
- [x] T002 Move `resolveIp` from `src/middlewares/rate-limit.js` into `packages/network-utils/index.js` as `resolveSourceIp(req)`; rate-limit and health-check import it; existing tests pass
- [x] T003 [P] Add `iamRoleStatements` for `ssm:GetParameter` on `arn:aws:ssm:*:*:parameter/salmon-api/${stage}/AVAILABILITY_TABLE` in `serverless.yml`; new env keys in `config/env.prod.yml`, `config/env.local.yml`, `.env.example`: `TRM_API_KEY`, `TRM_MAX_RPS`, `SANCTIONS_SOURCE_URL`, `JUPITER_API_KEY`, `JUPITER_MAX_RPS`, `JUPITER_SWAP_URL`, `ZEROEX_*`, `SWAP_*`, `AVAILABILITY_TABLE_JSON` (local only), `AVAILABILITY_COUNTRY_OVERRIDE` (local only)

## Phase 2: Foundational — geolocation (User Story 2 depends on all of it)

- [x] T004 [P] `src/availability/platform.js` + spec: header → `ios|android|extension`, default `ios`
- [x] T005 [P] `src/availability/country-resolver.js` + spec: open the mmdb once per container, `countryOf(ip)` → alpha-2 or null (private/invalid/unknown → null); local-only `AVAILABILITY_COUNTRY_OVERRIDE` honoured when `NODE_ENV !== 'prod'`
- [x] T006 `src/availability/availability-table.js` + spec: built-in default (spec decision 3, `data-model.md`), `AVAILABILITY_TABLE_JSON` local override, runtime SSM read with 5-min cache, validation (providers, platforms, Jupiter prohibited list constant, version), keep-last-good on failure with `[AVAILABILITY_TABLE]` error log
- [x] T007 `src/availability/availability-service.js` + spec: `decide(capability, platform, country)` → `{ enabled, reason?, provider? }` (platform override merge, unavailable, providers, default; null country → default provider); `listFor(networkId, platform, country)` = registry ∩ stage config ∩ decide
- [x] T008 `src/middlewares/powerup-gate.js` + spec: `powerupGate(capability)` (string or `'param'` for `:id`), resolves platform + country, `403 region_restricted` with no provider call, sets `res.locals.availability`, logs `{ capability, platform, country, enabled, provider }` and never the address

## Phase 3: User Story 2 — offered only where it may be offered (P1) 🎯 MVP of the geolocation

- [x] T009 [US2] `GET /availability` in `src/routes/solana/solana-powerups-router.js` (declared before `/:id/build`), `Cache-Control: no-store`, controller `availability` in `src/controllers/solana/solana-powerups-controller.js`, resource `src/resources/solana/solana-powerup-availability-resource.js`; spec per `contracts/availability.md`
- [x] T010 [US2] Mount `powerupGate('param')` on `/:id/build` (replacing the no-op) and keep `signing-boundary.spec.js` green
- [x] T011 [US2] Gate tests for every table outcome (blocked country, allowed, null country, platform override, US on every platform, invalid table keeps previous), in `src/middlewares/__tests__/powerup-gate.spec.js`
- [x] T012 [US2] `docs/openapi.yaml`: the availability route and the `X-Salmon-Platform` header; `AGENTS.md` contract `capability-availability`

## Phase 4: User Story 3 — screening (P1)

- [x] T013 [P] [US3] `src/repositories/shared/sanctions-repository.js` + spec: TRM cache get/set (24 h), local set membership, atomic replace (`:next` + `RENAME`), `fetched_at`
- [x] T014 [P] [US3] `src/infrastructure/providers/profiles.js`: `trm` row (1 rps default, `TRM_MAX_RPS`, 5 s, no retry); `jupiter` (10 rps) and `zeroex` (5 rps) rows for later phases
- [x] T015 [US3] `src/services/shared/sanctions-service.js` + spec: `isListed(address)` = cache → TRM via `providerCall('trm')` (header `TRM-API-Key` when set) → local set; both unavailable → `SanctionsUnavailableError` (503 `upstream_unavailable`); staleness > 48 h logs `[SANCTIONS_STALE]`
- [x] T016 [US3] `refreshSanctionsJob` in `src/jobs/handler.js` + spec with a recorded CSV fixture: follow redirects, extract every `Digital Currency Address - <SYMBOL> <address>`, zero addresses = failure; schedule `rate(1 day)` in `serverless.yml`
- [x] T017 [US3] Gate: on rows whose provider is in `SCREENED_BY_SALMON` (Jupiter), call `isListed` → `403 wallet_restricted`; 0x rows skip; spec cases in `powerup-gate.spec.js`

## Phase 5: User Story 1 — the swap build, 0x behind the gate first (P1)

- [x] T018 [US1] Bring `src/services/solana/swap/*` (build service, 0x adapter, unsigned builder, cleanup, errors, tests), `src/resources/solana/solana-swap-build-resource.js` + spec, the `build` controller in `src/controllers/solana/solana-ft-controller.js`, and the `SwapBuild` schema in `docs/openapi.yaml` from `origin/feat/powerup-swap` onto this branch (cherry-pick or copy; no history rewrite)
- [x] T019 [US1] Replace the branch's `zeroex-rate-limiter` with `providerCall('zeroex')`; `PROVIDER` constants move into `zeroex-swap-provider.js`; build service takes the adapter from `res.locals.availability.provider`
- [x] T020 [US1] `router.get('/swap/build', powerupGate('swap'), safe(controller.build))` in `src/routes/solana/solana-ft-router.js`; 400 on non-mainnet before any provider call; `signing-boundary.spec.js` green
- [x] T021 [US1] Fixture tests: build on a 0x row → unsigned v0, fee payer = caller, fee account referenced, `provider: '0x'`; `provider_fee_mismatch`; `no_route`; row without credential → 503

## Phase 6: User Story 4 — Jupiter adapter (P1)

- [x] T022 [US4] `src/services/solana/swap/jupiter-swap-provider.js` + spec with a recorded `/swap/v2/build` fixture: request (`platformFeeBps`, `feeAccount`, `x-api-key`), flatten instruction groups, lookup tables, `amountOut`/`minAmountOut` from `outAmount`/`otherAmountThreshold`, `routePlan`, `providerRequestId`; 400/404 → `no_route`; `PROVIDER = { id: 'jupiter', displayName: 'Jupiter', attribution: 'Powered by Jupiter' }`
- [x] T023 [US4] Build service: adapter registry `{ jupiter, '0x' }`; `feeAccount` for Jupiter = existing `resolveFee` result (output ATA under the mint's program); `routeFee` from the provider (`null` for Jupiter)
- [x] T024 [US4] Fixture tests: build on a Jupiter row → unsigned v0 with the fee account referenced and `provider: 'jupiter'`; table row switch 0x ↔ jupiter keeps the shape (SC-005)
- [x] T025 [US4] Nightly external tests in `src/services/solana/swap/__tests__/*.integration.spec.js` for both providers (fee instruction present, zero signatures), wired into `integration-external.yml`

## Phase 7: Polish

- [x] T026 `CHANGELOG.md` (0.20.0), `AGENTS.md` (availability, screening, swap contracts), `docs/openapi.yaml` final pass, `README`/`.env.example`
- [x] T027 `npm run lint:check`, `format:check`, `test:unit`, hermetic integration; `scripts` smoke per `quickstart.md`
- [~] T028 Load `AVAILABILITY_TABLE` (initial document) and `TRM_API_KEY` (when DEV-76 delivers it) into SSM; `SANCTIONS_SOURCE_URL` — `AVAILABILITY_TABLE` loaded 2026-09-30; `TRM_API_KEY` waits for DEV-76

## Frontend (salmon-wallet-frontend, branch `feat/powerup-swap`, spec 027)

- [ ] F001 `X-Salmon-Platform` in `packages/shared/src/api/client.ts` from the build's platform + test
- [ ] F002 `useNetworkPowerups` reads `/powerups/availability` (uncached) and exposes `provider`; `/v1/networks.powerups` no longer read; tests
- [ ] F003 Swap screens mounted in mobile and extension per spec 027, attribution and fee lines from data; `region` / `wallet` unavailable states on the shared surface; i18n en/es; DOM parity
- [ ] F004 iOS build keeps the flag as the emergency switch only; all three builds ship with swap on

## Dependencies

- T004–T008 before T009–T012 (US2). T013–T017 (US3) after T008. T018–T021 (US1) after T008 and T014. T022–T025 (US4) after T019. F001–F004 after T009 and T020 exist on a deployed stage.

## Parallel opportunities

- T004 ∥ T005; T013 ∥ T014; T022 can start from the fixture while T018–T021 land.

## MVP

Phases 1–3: the availability route and the gate answer real countries on the deployed stage, with nothing to sell yet. That is the first deploy.
