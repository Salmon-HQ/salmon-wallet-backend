# Feature Specification: Community Powerups — backend contract

**Feature Branch**: `015-community-powerups`

**Created**: 2026-09-11

**Input**: User description: "Community Powerups backend: generic unsigned build endpoint per Powerup id, allowlist with reason codes on /v1/networks, contributor attribution, registry maintained by Salmon"

> Counterpart of the frontend spec `specs/029-community-powerups/spec.md`
> client side (manifest, disclosure, twins, review checklist); this one
> owns everything the backend publishes and builds. Neither side
> implements before the hold lifts.

## The property

**A third party can ship a Powerup inside Salmon without ever touching this
repository, and a Powerup that builds a transaction never gets its bytes
from anyone but Salmon.** The contributor delivers a manifest and UI to
the frontend repo. Salmon maintainers add the backend side: one registry
entry, and for transaction-building Powerups one build adapter they wrote
and reviewed. The signing boundary (root `AGENTS.md`) is unchanged: the
backend returns unsigned bytes, the device signs, the device broadcasts.

## Owner decisions (2026-09-11)

2. A disabled Powerup carries a reason code.
3. The build response carries who contributed the Powerup, next to the data-provider attribution.
4. Install scope is per device; the backend persists nothing per wallet or public key.
5. Read-only Powerups are switched off by id via the allowlist; there is no per-endpoint switch.
6. Contributors never modify the backend repo. Read-only Powerups call their protocol's own endpoints from the client. Transaction-building Powerups get bytes only from Salmon.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The wallet learns which Powerups exist and why one is off (Priority: P1)

The wallet asks the network catalog and receives, per network, the list of
Powerups the backend offers, each with an enabled flag and, when disabled,
a reason it can show the user. A Powerup the backend does not list is not
offered at all.

**Why this priority**: Every other story depends on it; it is the kill
switch the owner keeps for every Powerup, core or community, and the only
way an installed Powerup can explain its own absence instead of showing a
blank surface.

**Independent Test**: Call `GET /v1/networks` on each stage and read
`powerups` on `solana-mainnet`; flip one entry to disabled with a reason
in the stage config and confirm the response reflects it without a
deploy of the client.

**Acceptance Scenarios**:

2. **Given** a Powerup listed as disabled with reason `maintenance`, **When** `/v1/networks` is called, **Then** its entry is `{ id, enabled: false, reason: 'maintenance' }`.
3. **Given** a Powerup absent from the stage config, **When** `/v1/networks` is called, **Then** it does not appear in `powerups` at all.
4. **Given** a network with no Powerups, **When** `/v1/networks` is called, **Then** `powerups` is `[]` (never absent, so the client does not fail closed on a valid network).
5. **Given** the response is served through the CDN cache, **When** two users in different countries call it, **Then** the bytes are identical (region is never part of this field).

---

### User Story 2 - A transaction-building Powerup gets unsigned bytes from Salmon (Priority: P1)

The wallet calls one generic endpoint with the Powerup id and that
Powerup's own parameters, and receives an unsigned transaction in the same

**Why this priority**: This is the only path by which a community Powerup
may move funds. Without it, community Powerups are display-only.

**Independent Test**: Register a fixture Powerup in the test registry
whose adapter builds a trivial transfer; call the endpoint with valid
params and decode the transaction: zero signatures, the caller is the fee
payer, every program it touches is in the Powerup's declared list.

**Acceptance Scenarios**:

1. **Given** a registered, enabled Powerup and valid params, **When** `GET /v1/{networkId}/powerups/{id}/build` is called, **Then** 200 with `transaction` (base64, unsigned, caller as fee payer), `expiresAt`, `provider`, `providerDisplayName`, `attribution`, `salmonFee` (object or `null`), `routeFee` (`null` unless the adapter reports one), `contributor: { name, url } | null`, and the adapter's typed fields.
2. **Given** an id not in the registry or not enabled on the stage, **When** the endpoint is called, **Then** 404 `not_found` (it is not offered), never `region_restricted`.
3. **Given** an id registered as read-only (no adapter), **When** the endpoint is called, **Then** 404 `not_found`.
4. **Given** the adapter rejects the params, **When** the endpoint is called, **Then** 400 `missing_parameter` / `invalid_parameter` with the parameter named, before any upstream call.
5. **Given** the adapter produced instructions touching a program not in the Powerup's declared program list, **When** the build is validated, **Then** 502 `provider_program_mismatch`, the transaction is not returned, and a `[POWERUP_PROGRAM_MISMATCH]` line is logged with the Powerup id and the program id.
6. **Given** a build that simulates with an error, **When** the endpoint is called, **Then** 422 `simulation_failed` with the simulation message, never a transaction the user would pay to see fail.
7. **Given** the upstream the adapter depends on is unavailable, **When** the endpoint is called, **Then** the resilience layer's 503 (`upstream_unavailable` / `upstream_rate_limited` / `request_budget_exhausted`) is returned unchanged.

---

### User Story 3 - A region-restricted or sanctioned wallet is refused before any build (Priority: P2)

Every Powerup build route passes through the gate specified in
`011-region-gating` before the adapter runs. Until that spec is
implemented, the gate is a pass-through with a single seam.

**Why this priority**: The owner keeps geolocation open (PR #13 stays);
the generic route must have the seam from day one so gating is one
middleware, not one edit per Powerup.

**Acceptance Scenarios**:

1. **Given** spec 011 is implemented and the viewer country is outside the Powerup's allowlist, **When** the build route is called, **Then** 403 `region_restricted` and no adapter runs.
2. **Given** spec 011 is not implemented, **When** the build route is called, **Then** the gate is a no-op and the adapter runs (documented as such in the gate's header).
3. **Given** spec 011 is implemented and the address is on the screening list, **When** the build route is called, **Then** 403 `wallet_restricted`.

---

### User Story 4 - A read-only Powerup needs nothing from the backend beyond the allowlist (Priority: P3)

A Powerup that only displays data from its protocol's own endpoints is a
registry entry with no adapter. The backend lists it (with its contributor
and its declared endpoints, for the reviewer's record) and can switch it
off by id.

**Acceptance Scenarios**:

1. **Given** a read-only Powerup registered and enabled, **When** `/v1/networks` is called, **Then** it appears in `powerups` as `{ id, enabled }` like any other — the catalog publishes only `{ id, enabled, reason? }`; contributor and endpoints are the registry's (reviewer's) record.
2. **Given** it is switched off with reason `deprecated`, **When** `/v1/networks` is called, **Then** `{ id, enabled: false, reason: 'deprecated' }` and its build route answers 404.

### Edge Cases

- `reason` values are a closed set: `region`, `maintenance`, `deprecated`. A stage config with any other value fails at startup (same posture as an unsupported `NODE_ENV`): a typo must not ship as "enabled: false with no reason".
- `region` as a stage-level reason means "not offered in any region we serve from this stage"; per-request region refusals stay on the build route (spec 011) and never leak into the cached catalog.
- A Powerup enabled on the stage but declared for a network the stage disables is not listed on that network.
- Params are validated per id from the adapter's declared schema; unknown query params are ignored, never forwarded to an upstream.
- The generic route is mounted under the chain slice (`/v1/solana-:env/powerups/...`) like `/ft`, so `multinetwork` resolves `locals.network` upstream; a Powerup declared for `solana-mainnet` only answers 404 on devnet.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The backend MUST keep a Powerup registry maintained by Salmon: per id — `tier` (`core` | `community`), `networks`, `contributor: { name, url } | null`, `programIds` (transaction-building only), `endpoints` (read-only only, for the record), and an optional build adapter. The registry is code in this repo; it is never loaded from a remote source or from user input.
- **FR-002**: The per-stage capabilities config MUST declare, per Powerup id, `enabled` and, when disabled, `reason` from the closed set; a value outside the set MUST fail the config load loudly.
- **FR-003**: `GET /v1/networks` MUST publish `powerups: Array<{ id, enabled, reason? }>` on every network (empty array when none), derived from registry ∩ stage config ∩ the Powerup's networks, region-agnostic and cacheable.
- **FR-005**: The build MUST refuse any transaction whose instructions reference a program outside the Powerup's declared `programIds` (502 `provider_program_mismatch`) and any transaction whose simulation fails (422 `simulation_failed`), before returning bytes.
- **FR-007**: Every upstream call an adapter makes MUST go through `providerCall` with a profile row (spec 014); an adapter MUST NOT build its own limiter, retry loop or timeout.
- **FR-008**: The build route MUST pass through one gate middleware (`powerupGate`) that is a documented no-op until spec 011 is implemented, and MUST log `[POWERUP_BUILD]` with Powerup id, network and outcome (never the IP).
- **FR-010**: Root `AGENTS.md` MUST gain a `community-powerups` contract bullet and a "Contributing a Powerup" rule stating that contributors never touch this repo and how a maintainer adds a registry entry / adapter; `CHANGELOG.md` MUST record the new surface.
- **FR-011**: The full CI gate MUST pass; the registry, the catalog field, the gate seam, the program-list validation and every error branch MUST be unit-tested with a fixture Powerup; no live provider in the PR gate.

### Key Entities

- **Powerup registry entry**: `{ id, tier, networks, contributor, programIds?, endpoints?, adapter? }` — Salmon-maintained code.
- **Stage Powerup config**: `{ [id]: { enabled: boolean, reason?: 'region' | 'maintenance' | 'deprecated' } }` next to `network-capabilities-<stage>.js`.
- **Catalog entry** (public): `{ id, enabled, reason? }` per network on `/v1/networks`.

## Success Criteria _(mandatory)_

- **SC-001**: A client that reads only `/v1/networks` can decide, for 100% of Powerups, whether to offer them and what to say when it cannot, without a client release.
- **SC-002**: A fixture transaction-building Powerup goes from registry entry to a decodable unsigned transaction with no change outside `src/*/powerups` and the stage config.
- **SC-003**: A build touching an undeclared program is refused 100% of the time in tests; no such transaction ever reaches a client.
- **SC-004**: Switching a Powerup off with a reason is one config edit + deploy, effective on the next catalog fetch, with zero client change.
- **SC-005**: `/v1/networks` stays byte-identical across viewer countries.
- **SC-006**: Unit suite, lint, format, `serverless print` and the signing-boundary scan pass.

## Assumptions

- Spec 011 (region gating) ships separately; this feature only leaves the middleware seam and reuses its error codes.
- Contributor governance (CLA, review SLA, CODEOWNERS) is a separate document owned by the frontend spec 029 non-goals.

## Out of scope

- Any execute / relay / broadcast route (signing boundary).
- Server-side install state, per-public-key preferences, or any persistence per user.
- Per-endpoint kill switch for read-only Powerups (owner: by id only).
- Per-Powerup fee rates or revenue sharing.
- A remote or user-supplied registry.
