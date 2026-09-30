# Implementation Plan: Swap on Jupiter, 0x where Jupiter cannot, offered where it may be offered

**Branch**: `018-swap-jupiter-availability` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-swap-jupiter-availability/spec.md`

## Summary

Geolocation first, swap second. The backend resolves the caller's country
from the source address API Gateway attaches to every request (not from a
header anyone can write), looks up (capability, platform, country) in a
configuration table read at runtime, and answers two things with it: an
uncached availability list for the catalogue and the screens, and a gate on
every build route that refuses with `403 region_restricted` before any
provider is called. The swap build route from spec 012 comes back behind
that gate with a provider chosen by the table row: a new Jupiter Router
adapter by default, the existing 0x adapter where Jupiter's terms do not
allow it. Jupiter rows are screened against Salmon's own daily copy of the
US Treasury sanctions list; 0x rows rely on 0x's screening. Nothing about
signing changes: the transaction leaves unsigned, the device signs and
broadcasts.

## Technical Context

**Language/Version**: Node 24, Express 5 behind `serverless-http` on AWS Lambda (us-east-1), Jest 30.

**Primary Dependencies**: `@solana/web3.js` 1.99 (v0 messages, lookup tables), `axios`, the existing `providerCall` (rate limiter, breaker, budget), Redis (`packages/redis-connector`). New: `@ip-location-db/dbip-country-mmdb` + `mmdb-lib` (country by address, ~8 MB database in the bundle) and the SSM client the Lambda runtime ships, for the runtime table read.

**Storage**: Redis for the sanctions copy (one set + a fetched-at key) and the existing caches; SSM Parameter Store for configuration; no per-user data (spec FR-011).

**Testing**: Jest unit tests with recorded fixtures; the existing `signing-boundary.spec.js`; the hermetic Redis integration job; one nightly external integration test per provider (`integration-external.yml`).

**Target Platform**: Lambda `nodejs24.x`; callers are iOS, Android and the browser extension, which send their platform in a header.

**Project Type**: web service (this repo) + three client apps (frontend repo, spec 027).

**Performance Goals**: a build request adds at most one in-memory lookup (country), one Redis membership check (screening on Jupiter rows) and one provider call; the availability route answers from memory and Redis only.

**Constraints**: Jupiter 10 requests per second, 0x 5; deploy-time env cannot carry the table (spec: changeable without a deploy), so the table is read from SSM at runtime with a short cache and a built-in default; the country database ships inside the bundle and is refreshed by dependency update.

**Scale/Scope**: hundreds to low thousands of requests per day today; the table has three platforms × a few dozen country rows.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

`.specify/memory/constitution.md` is the unfilled template, so no
constitution gates apply. The repo's standing rules from `AGENTS.md` are
the gate instead, and all pass:

- **Signing boundary**: the swap route stays `GET …/ft/swap/build`; no route accepts signed bytes or broadcasts. `signing-boundary.spec.js` keeps passing.
- **Provider calls through `providerCall`**: the Jupiter adapter adds a `jupiter` row to `profiles.js` and 0x a `zeroex` row; the OFAC download and the country lookup are not wallet-provider calls and use bounded `axios` / local reads.
- **Cached catalogue stays region-agnostic**: availability is its own `no-store` route; `/v1/networks` is untouched.
- **No per-user persistence**: country and platform live in `res.locals` for the request; logs carry the country code and the outcome, never the address beside a country.

## Project Structure

### Documentation (this feature)

```text
specs/018-swap-jupiter-availability/
├── plan.md              # This file
├── research.md          # Phase 0: country data, sanctions source, table storage, platform signal, Jupiter fee mapping
├── data-model.md        # Phase 1: table, decision, sanctions copy, profiles, build response
├── quickstart.md        # Phase 1: run and verify locally
├── contracts/
│   ├── availability.md  # GET /v1/solana-{env}/powerups/availability
│   ├── platform-header.md
│   └── swap-build.md    # delta over spec 012
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/availability/
├── country-resolver.js          # sourceIp (rate-limit.js resolver, moved to packages/network-utils) → ISO-3166 alpha-2 | null; mmdb opened once per container
├── platform.js                  # X-Salmon-Platform → 'ios' | 'android' | 'extension'; missing/unknown → 'ios'
├── availability-table.js        # runtime SSM read (5 min cache) → validated table; built-in default = spec owner decision 3; invalid → keep last good, log
└── availability-service.js      # decide(capability, platform, country) → { enabled, reason?, provider? }; listFor(networkId, platform, country)

src/middlewares/powerup-gate.js  # real gate: capability from route param or fixed ('swap'); 403 region_restricted; sets res.locals.availability
src/routes/solana/solana-powerups-router.js   # + GET /availability (no-store) before /:id/build
src/routes/solana/solana-ft-router.js         # + GET /swap/build behind powerupGate('swap') (route from feat/powerup-swap)
src/controllers/solana/solana-powerups-controller.js  # + availability(req, res)
src/resources/solana/solana-powerup-availability-resource.js

src/services/shared/sanctions-service.js      # isListed(address); staleness; 503 when empty
src/repositories/shared/sanctions-repository.js
src/jobs/handler.js                           # + refreshSanctionsJob (daily): download, extract Digital Currency Address values, replace the set atomically
serverless.yml                                # + refreshSanctionsJob schedule; iamRoleStatements for ssm:GetParameter on /salmon-api/${stage}/AVAILABILITY_TABLE

src/services/solana/swap/                      # from feat/powerup-swap, unchanged unless noted
├── solana-swap-build-service.js              # adapter chosen from res.locals.availability.provider; PROVIDER constants move into the adapters
├── zeroex-swap-provider.js                   # unchanged
├── jupiter-swap-provider.js                  # NEW: GET /swap/v2/build → internal adapter shape
├── unsigned-transaction-builder.js           # unchanged
└── __tests__/                                # + jupiter fixtures; gate tests; screening tests
src/infrastructure/providers/profiles.js      # + jupiter (10 rps), zeroex (5 rps)
config/env.prod.yml, config/env.local.yml, .env.example   # + JUPITER_*, ZEROEX_*, SWAP_*, SANCTIONS_SOURCE_URL
docs/openapi.yaml, AGENTS.md, CHANGELOG.md, NOTICE (DB-IP attribution)

Frontend (salmon-wallet-frontend, spec 027; its own branch feat/powerup-swap):
packages/shared/src/api/client.ts             # X-Salmon-Platform on every request
packages/shared/src/hooks/useNetworkPowerups.ts  # allowlist from /powerups/availability (uncached) instead of /v1/networks; carries provider
packages/shared/src/powerups/swap/            # screens mounted in the three apps; attribution and fee lines rendered from data
```

**Structure Decision**: one new folder `src/availability/` holds everything
about "where a capability is offered"; the swap folder from the old branch
is brought over as is and gains one adapter; screening is a shared service
because it is a property of a wallet address, not of Solana.

## Phases

- **Phase 0 — research**: done, `research.md` (R1–R9).
- **Phase 1 — design**: done, `data-model.md`, `contracts/`, `quickstart.md`.
- **Phase 2 — tasks** (`/speckit-tasks`), in this order:
  1. Geolocation: resolver, platform, table, service, gate, availability route, tests.
  2. Sanctions copy: repository, service, daily job, tests.
  3. Swap route back behind the gate with the 0x adapter from the old branch; provider selection from the row.
  4. Jupiter adapter, profile row, fixtures, fee mapping.
  5. Config, docs, changelog, nightly integration tests.
  6. Frontend: header, availability hook, screens (its own branch and tasks).

## Deviations from spec

- **Table changes without a deploy** are met through a runtime SSM read
  with a 5-minute cache, not through the deploy-time `${ssm:}` the rest of
  the config uses. A table edit takes up to 5 minutes, not a release. The
  built-in default equals the spec's initial rows, so a failed read never
  opens a country.
- **Spec 011's "refuse a request that did not arrive through the edge"**
  (spec 018 FR-005) is met differently: the country comes from API
  Gateway's `sourceIp`, which no caller can set, so there is no edge header
  to protect and no reason to refuse direct callers for this feature.
  DEV-22 stays valuable for the WAF, not for the country.
- **Crimea, Donetsk and Luhansk** cannot be told apart from the rest of
  Ukraine with a country-level database (research R4). Refusing all of
  Ukraine is not acceptable; the gap is recorded for counsel.

## Complexity Tracking

No constitution violations to justify.
