# Feature Specification: Region gating for Powerups

**Feature Branch**: `011-region-gating`

**Created**: 2026-09-02

**Status**: Draft — approved for later implementation, not started

**Input**: User description: "Per-Powerup country allowlist decided server-side from CloudFront viewer country, with the API Gateway origin locked to CloudFront and sanctions screening of wallet addresses"

> **Implementation note:** this spec was written ahead of time. When
> implementing, **create a fresh branch from `main`**. Depends on spec 010
> (signing boundary) being merged first, and on the frontend's spec 027
> (Powerups boundary) for the client side of the contract. Do not start
> before the owner confirms the initial country list (see Assumptions).

## Context

Apple's Guideline 3.1.5(iii) allows exchange features "only in countries
or regions where the app has appropriate licensing and permissions", and
Jupiter's Terms list the United States (and others) as prohibited
localities for wallets it interacts with. When Swap (or any Powerup with a
third-party counterparty) returns, the backend must be able to refuse to
serve it to a user in a country where it is not offered — and that
decision must be one a modified client cannot bypass.

Today there is no country logic anywhere: `GET /ip` (ip-api.com) exists
and no client calls it; the API Gateway invoke URL is reachable directly,
so any header a request carries could be hand-written. The Jupiter API
license (§7.3) also obliges the integrator to screen wallet addresses
against sanctions lists and block flagged ones; nothing does that today.

This feature adds three things: a trustworthy country signal, a
per-Powerup country allowlist the backend enforces and publishes, and
wallet-address sanctions screening at quote time.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A user in a blocked country cannot use a gated Powerup (Priority: P1)

A user whose request arrives from a country outside a Powerup's allowlist
gets a clear "not available in your region" answer from the backend,
never a quote, and cannot get one by changing anything on the device.

**Why this priority**: This is the control Apple and the provider terms
require; if it can be bypassed it is worth nothing.

**Independent Test**: Request a gated endpoint with the country header
set to a blocked country → 403 `region_restricted`; with an allowed
country → normal response; with no country header → 403 (fail closed);
directly against the API Gateway URL (bypassing CloudFront) → rejected.

**Acceptance Scenarios**:

1. **Given** a request from a blocked country, **When** it hits a gated
   endpoint, **Then** the response is 403 `{ error: 'region_restricted', error_description }`
   and no upstream provider is called.
2. **Given** a request with no viewer-country header, **When** it hits a
   gated endpoint, **Then** 403 `region_restricted` (fail closed).
3. **Given** a request that reaches the API Gateway URL without passing
   through CloudFront, **When** it hits any endpoint, **Then** it is
   rejected with 403 before routing.
4. **Given** a request from an allowed country, **When** it hits a gated
   endpoint, **Then** it is served exactly as before.
5. **Given** a non-gated endpoint (balances, history, NFTs, prices),
   **When** called from any country, **Then** it is served — the wallet
   itself is never region-gated, only Powerups.

---

### User Story 2 - The client can hide what the backend will refuse (Priority: P2)

Old and new builds learn from the backend which Powerups exist for their
stage and network, so a build cannot enable a Powerup the backend has
turned off — but the catalog stays region-agnostic and cacheable.

**Acceptance Scenarios**:

1. **Given** `/v1/networks`, **When** called, **Then** it carries
   `powerups: { [powerupId]: { enabled, networks } }` derived from the
   stage config, with no per-region information.
2. **Given** a Powerup disabled for the stage, **When** its gated endpoint
   is called, **Then** 404 `not_found` (it is not offered at all), not
   `region_restricted`.

---

### User Story 3 - A sanctioned wallet is refused before any quote (Priority: P1)

A wallet address on a sanctions list gets 403 `wallet_restricted` from
every gated endpoint, without a provider call, and the refusal is logged
without the IP.

**Why this priority**: Required by the Jupiter license (§7.3, §7.5) and
asked by Apple ("AML/KYC precautions"). No identity is collected — this
is address screening only.

**Acceptance Scenarios**:

1. **Given** an address on the screening list, **When** a gated endpoint
   is called, **Then** 403 `wallet_restricted`, no upstream call, one
   log line with the address and Powerup id (never the IP).
2. **Given** the screening source is unavailable, **When** a gated
   endpoint is called, **Then** 503 `screening_unavailable` — never a
   silent pass.

### Edge Cases

- Country header present but not a valid ISO 3166-1 alpha-2 code → treat
  as unknown → fail closed.
- Requests from inside AWS (health checks, scheduled jobs) carry no
  viewer-country header; they never call gated endpoints, so fail-closed
  is harmless. The health check must not be gated.
- Local docker / `serverless offline` has no CloudFront: the origin lock
  and country header are bypassed only when `NODE_ENV=local`, and the
  local capabilities file sets a permissive allowlist — documented, so
  nobody mistakes local behaviour for prod.
- US state granularity (`CloudFront-Viewer-Country-Region`) is read and
  logged but not used for gating in this feature; the allowlist is
  country-level. Keep the plumbing so a state-level list is a config
  change later.
- Sanctioned-country list and per-Powerup list are two lists: the
  sanctions list applies to every gated Powerup regardless of its own
  allowlist.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: CloudFront MUST forward `CloudFront-Viewer-Country` and
  `CloudFront-Viewer-Country-Region` to the API origin (managed origin
  request policy), and MUST add a secret origin header; the backend MUST
  reject (403 `origin_not_trusted`) any request lacking the correct secret
  except when `NODE_ENV=local`.
- **FR-002**: A per-stage config (next to `network-capabilities-*.js`)
  MUST declare, per Powerup, an `enabled` flag, the networks it applies
  to, and a country allowlist; plus one global sanctioned-country
  denylist. An empty allowlist means "nowhere".
- **FR-003**: A middleware MUST gate the routes a Powerup declares, in
  this order: Powerup disabled for stage → 404; sanctioned country or
  unknown country → 403 `region_restricted`; country not in allowlist →
  403 `region_restricted`; wallet address on the screening list → 403
  `wallet_restricted`; screening source down → 503
  `screening_unavailable`.
- **FR-004**: `/v1/networks` MUST publish `powerups: { [id]: { enabled, networks } }`
  (stage-derived, region-agnostic, cacheable) alongside `sections`.
- **FR-005**: Region decisions MUST be logged with country, Powerup id
  and outcome — never the IP, never the address in the region log.
- **FR-006**: Wallet screening MUST use a list the team controls or a
  provider the owner picks (decision recorded in the plan); the interface
  is `isRestricted(address) → Promise<boolean>` so the source is
  swappable.
- **FR-007**: `GET /ip` MUST be removed (unused, and it would give the
  client a country to argue with).
- **FR-008**: The allowlist config, the origin secret rotation and the
  fail-closed behaviour MUST be documented in `docs/DEPLOY.md` and the
  deploy-runbook skill; `AGENTS.md` gains a "Region gating" rule.
- **FR-009**: The full CI gate MUST pass; gating logic MUST be
  unit-tested with header fixtures, and one hermetic integration test
  MUST prove the origin lock rejects a request without the secret.

### Key Entities

- **Powerup gating config**: `{ id, enabled, networks: string[], countries: string[] }`
  per stage; global `sanctionedCountries: string[]`.
- **Viewer country**: ISO 3166-1 alpha-2 from CloudFront, or unknown.
- **Screening verdict**: restricted / clear / unavailable, per address.

## Success Criteria _(mandatory)_

- **SC-001**: With the secret header absent, 100% of requests to the API
  Gateway URL are rejected in prod; with CloudFront in front, the wallet
  works unchanged.
- **SC-002**: A gated endpoint answers 403 `region_restricted` for every
  blocked or unknown country and normally for allowed ones, with zero
  provider calls on refusal.
- **SC-003**: `/v1/networks` carries the `powerups` map and remains
  byte-identical across countries.
- **SC-004**: A listed address is refused with 403 `wallet_restricted`
  on every gated route.
- **SC-005**: Unit + hermetic integration + `serverless print` pass.

## Assumptions

- **Initial allowlist is an owner decision, not a default.** Starting
  point from the 2026-09-02 research: Swap excludes the United States
  (Jupiter terms), the United Kingdom (FCA promotions regime) and all
  sanctioned jurisdictions; the European Union is pending counsel (MiCA
  Art. 3(1)(16)(g)). The list is config, and App Store Connect country
  availability is kept in sync with it by the owner.
- CloudFront distribution `E394LJ6ODNZBST` fronts API Gateway
  `te4x28v8e0`; changing its origin request policy and adding a custom
  origin header are console/IaC changes outside `serverless.yml` and are
  listed in the plan as ops steps.
- The frontend (spec 027) renders the `region_restricted` and
  `wallet_restricted` states and never requests device location.

## Out of scope

- Swap v2 itself — spec 012 (it is the first consumer of this gate).
- KYC or identity collection of any kind.
- State-level (US) gating — plumbing only.
