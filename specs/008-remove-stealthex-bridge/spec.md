# Feature Specification: Remove the StealthEX bridge

**Feature Branch**: `008-remove-stealthex-bridge`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "Remove the StealthEX bridge aggregator surface from the backend: routes, controller, service, repository, resources, client, catalogue, env vars, docs"

## Context

Apple rejected iOS 1.0.3 under Guideline 3.1.5(iii). The cross-chain
Bridge is a centralized-exchange flow: the backend creates an order with
StealthEX using partner credentials, the user sends funds to a StealthEX
deposit address, and StealthEX holds them until payout. No architecture
change makes that non-custodial. The Terms published on 2026-09-01 (§3)
already state that this version offers no service "for exchanging, buying,
selling, converting, or transferring assets between different networks".
The next release ships Portfolio and Collectibles only; the code must match
the terms.

The frontend removal is coordinated separately with the frontend session;
this feature is the backend half.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - No bridge surface exists (Priority: P1)

A client calling any former bridge endpoint gets the standard 404
envelope, and no StealthEX credential, host or code path remains in the
backend or its deploy configuration.

**Why this priority**: The build submitted to Apple must contain no path
to a centralized exchange, and the review package will state that.

**Independent Test**: `GET /v1/bridge/*` and `POST /v1/bridge/*` answer
404 `not_found`; a repo-wide search for StealthEX finds nothing outside
git history; `serverless print` resolves with no `STEALTHEX_*` variables.

**Acceptance Scenarios**:

1. **Given** the change, **When** any `/v1/bridge` path is requested,
   **Then** the catch-all 404 answers with the standard error envelope.
2. **Given** the change, **When** the prod config is rendered, **Then** no
   `STEALTHEX_URL` / `STEALTHEX_API_KEY` reference exists.
3. **Given** the change, **When** unit tests run, **Then** no bridge suite
   exists and every other suite passes unchanged.

---

### User Story 2 - Unrelated "bridge" meaning survives (Priority: P2)

Solana transaction history keeps labelling on-chain bridge programs
(e.g. Wormhole) as before — the word "bridge" in the source catalog is a
program name, not the removed product.

**Acceptance Scenarios**:

1. **Given** a Wormhole transaction, **When** history is requested, **Then**
   its source label is unchanged.

### Edge Cases

- `error-handler.js` mentions StealthEX in the comment explaining upstream
  4xx mapping: keep the mapping (Jupiter, Blockdaemon, RPC still rely on
  it), drop only the name.
- `connect-tuning.js` may pre-warm the StealthEX host: remove that entry
  only.
- Prod SSM parameters `/salmon-api/prod/STEALTHEX_*` are outside the repo;
  their deletion is an ops step listed in the plan, not part of this
  change.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: All `/v1/bridge` routes, their controller, service,
  repository, resources, StealthEX client and catalogue, and their tests
  MUST be removed.
- **FR-002**: `STEALTHEX_URL` and `STEALTHEX_API_KEY` MUST be removed from
  `serverless.yml`/`config/*`, `.env.example` and `jest.setup.js`.
- **FR-003**: `docs/openapi.yaml`, `docs/ARCHITECTURE.md`, `README.md`,
  `AGENTS.md` (root + nested) and the Claude/Codex skills MUST no longer
  describe the bridge or StealthEX; the `bridge-aggregator` contract entry
  MUST be deleted.
- **FR-004**: Mentions of "bridge" that name on-chain programs
  (`program-sources.js`, `content-urls.js`, parser tests) MUST be kept.
- **FR-005**: No npm dependency may be removed unless it was used only by
  the bridge (verify with grep before uninstalling).
- **FR-006**: The full CI gate MUST pass.

## Success Criteria _(mandatory)_

- **SC-001**: `grep -ri stealthex` over the tracked tree returns nothing.
- **SC-002**: Unit suite passes with the bridge suites gone; hermetic
  integration and `serverless print --stage local` pass.
- **SC-003**: `docs/openapi.yaml` has no `/v1/bridge` paths.

## Assumptions

- The frontend removes its Bridge UI and client in its own repo; until it
  does, the Bridge tab would show a 404-driven error — acceptable because
  the next release ships without the tab.

## Out of scope

- Swap (Jupiter) — untouched in this feature.
- Bitcoin send broadcast — feature 009.
