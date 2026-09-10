# Feature Specification: Signing boundary

**Feature Branch**: `010-signing-boundary`

**Created**: 2026-09-02

**Status**: Draft — approved for later implementation, not started

**Input**: User description: "Enforce in CI that the backend never receives a signed transaction, and remove the Jupiter Ultra swap order/execute endpoints"

> **Implementation note for whoever picks this up:** this spec was written
> ahead of time. When implementing, **create a fresh branch from `main`**
> (this branch only carried the spec and was merged as documentation).
> Do not implement on `main`. Follow `plan.md`, then `/speckit-tasks`.

## Context

Apple's App Review questionnaire for Guideline 3.1.5(iii) asks whether the
developer handles transaction requests with the exchange directly. The
team's answer — and the architecture every peer wallet describes in its
terms — is that the user signs and broadcasts on the device and the
backend never touches a signed transaction. As of 2026-09-02 this is true
for every flow (send SOL/SPL, send BTC, NFT transfer/burn, dApp signing)
except the token swap, which still accepts a user-signed transaction at
`POST /v1/solana-{env}/ft/swap/execute` and relays it to Jupiter Ultra.

Jupiter has deprecated the Ultra API. The future swap (spec 012, later)
will be built on `GET /swap/v2/build`, which returns an unsigned
transaction the client signs and broadcasts itself, so the current
`/swap/order` + `/swap/execute` pair is dead code that also violates the
rule. The frontend hides Swap behind a build flag for the current release
and will rewrite its swap module against the v2 contract (frontend spec
027), so nothing shipped depends on these endpoints.

This feature does two things: turns the rule into a CI-enforced property,
and removes the one endpoint that breaks it.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A signed transaction can never reach the backend (Priority: P1)

A maintainer adding a new Powerup that accepts a signed transaction gets a
failing CI run with a message that points at the rule, before review.

**Why this priority**: The rule is the load-bearing statement in the
answer to Apple and to counsel; a property CI enforces is evidence, a
sentence in a doc is not.

**Independent Test**: Add a throwaway route that reads
`req.body.signedTransaction`; the boundary test fails naming the route.

**Acceptance Scenarios**:

1. **Given** the mounted Express app, **When** the boundary test runs,
   **Then** it passes with the current route set.
2. **Given** a new route whose handler reads a body field named
   `signedTransaction`, `tx`, `rawTx`, `serializedTransaction`,
   `signedTx` or `transaction` with a `signature`, **When** the test runs,
   **Then** it fails and names the route.
3. **Given** a new `POST`/`PUT`/`PATCH` route not present in the explicit
   allowlist, **When** the test runs, **Then** it fails and names the route.

---

### User Story 2 - The Ultra swap surface is gone (Priority: P1)

A client calling the former swap endpoints gets the standard 404
envelope; no Jupiter swap URL, referral account or fee configuration
remains in the repo or the deploy config.

**Acceptance Scenarios**:

1. **Given** the change, **When** `GET …/ft/swap/order` or
   `POST …/ft/swap/execute` is called, **Then** the catch-all answers 404
   `not_found`.
2. **Given** the change, **When** `/ft/verified` and `/ft/search` are
   called, **Then** they are unchanged (they share the router but not the
   swap service).
3. **Given** the rendered prod config, **When** inspected, **Then** no
   `JUPITER_SWAP_URL`, `JUPITER_SWAP_REFERRAL_ACCOUNT` or
   `JUPITER_SWAP_REFERRAL_FEE_BPS` reference exists.

---

### User Story 3 - Capability matrix stops advertising removed features (Priority: P2)

The `sections` matrix served by `/v1/networks` no longer lists `swap` or
`exchange` as active for any network, so a client that starts obeying the
matrix (frontend spec 027) does not enable a feature the backend cannot
serve.

**Acceptance Scenarios**:

1. **Given** any stage, **When** `/v1/networks` is called, **Then**
   `sections.swap` and `sections.exchange` are absent or inactive for
   every network.

### Edge Cases

- NFT burn and transfer are `POST` routes that **build unsigned**
  transactions — they must stay in the allowlist with a comment saying
  why they are allowed (they return bytes, they never receive signed
  bytes).
- `POST /v1/events` (analytics) is a separate Lambda and is not mounted on
  the main app; the boundary test covers the main app only, and the
  analytics payload allow-list already forbids transaction bytes.
- `jupiter-token-service`, `JUPITER_API_KEY` and `JUPITER_PRICE_URL` stay:
  `/ft/verified`, `/ft/search` and balance enrichment use them.
- The Solana transaction parser keeps recognising Jupiter swaps in
  history (`parser/parsers/jupiter.js`, `program-sources.js`) — that is
  reading on-chain data, not offering a swap.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: A unit test MUST walk every route mounted on the Express app
  and fail when a `POST`/`PUT`/`PATCH` route is not in an explicit
  allowlist kept next to the test, each entry carrying a one-line reason.
- **FR-002**: The same test (or a sibling) MUST fail when any controller
  reachable from a mounted route reads a request-body field whose name
  matches the signed-transaction denylist (`signedTransaction`, `tx`,
  `rawTx`, `serializedTransaction`, `signedTx`).
- **FR-003**: `AGENTS.md` MUST gain a "Signing boundary" rule stating that
  the backend never receives a private key, seed phrase or signed
  transaction, never broadcasts on a user's behalf, and that a Powerup's
  backend surface is quote → unsigned transaction → client signs → client
  broadcasts → backend reads status only.
- **FR-004**: `GET /ft/swap/order`, `POST /ft/swap/execute`, their
  controller actions, `solana-ft-swap-service`, the two swap resources,
  their tests, and the `solana-swap-orchestration` contract entry MUST be
  removed.
- **FR-005**: `JUPITER_SWAP_URL`, `JUPITER_SWAP_REFERRAL_ACCOUNT`,
  `JUPITER_SWAP_REFERRAL_FEE_BPS` MUST be removed from `config/*`,
  `.env.example`, `scripts/ssm-put-params.sh` and any skill/doc; the plan
  lists the SSM parameters for ops to delete.
- **FR-006**: `sections.swap` and `sections.exchange` MUST be removed from
  every `network-capabilities-*.js` (and their tests updated).
- **FR-007**: `docs/openapi.yaml`, `docs/ARCHITECTURE.md`, root and nested
  `AGENTS.md`, and the `solana-rpc-context` skill MUST no longer describe
  the Ultra swap; `CHANGELOG.md` gets a breaking-removal entry.
- **FR-008**: The full CI gate MUST pass.

### Key Entities

- **Mutating-route allowlist**: `{ method, path, reason }` entries; the
  only source of truth for which non-GET routes may exist on the main app.
- **Signed-transaction field denylist**: body field names that no
  controller may read.

## Success Criteria _(mandatory)_

- **SC-001**: The boundary test exists, passes on the resulting tree, and
  fails on a one-line injected violation (proved once during
  implementation, recorded in the PR).
- **SC-002**: `grep -rn "swap/execute\|swap/order\|JUPITER_SWAP" src config docs .env.example` returns nothing.
- **SC-003**: Unit, hermetic integration, `serverless print --stage local`
  and the OpenAPI parse pass.
- **SC-004**: `/ft/verified` and `/ft/search` specs pass unmodified.

## Assumptions

- The frontend's swap module is behind a build flag and will be rewritten
  for Swap v2; deleting these endpoints does not affect the submission
  build. Coordinated with the frontend session on 2026-09-02.
- Ops deletes `/salmon-api/prod/JUPITER_SWAP_URL`,
  `/salmon-api/prod/JUPITER_SWAP_REFERRAL_ACCOUNT` and
  `/salmon-api/prod/JUPITER_SWAP_REFERRAL_FEE_BPS` after the deploy (the
  referral account itself keeps any accrued fees; it is an on-chain
  account, not a parameter).

## Out of scope

- Swap v2 (`/swap/v2/build`), provider selection (0x/DFlow), region
  allowlist and wallet screening — specs 011/012.
- Frontend changes — spec 027 in the frontend repo.
