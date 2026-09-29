# Feature Specification: Signing boundary

**Created**: 2026-09-02

## Context

Apple's App Review questionnaire for Guideline 3.1.5(iii) asks whether the
developer handles transaction requests with the exchange directly. The
team's answer — and the architecture every peer wallet describes in its
terms — is that the user signs and broadcasts on the device and the
backend never touches a signed transaction. As of 2026-09-02 this was true
for every flow (send SOL/SPL, send BTC, NFT transfer/burn, dApp signing)

transaction the client signs and broadcasts itself, so the
spec 027), so nothing shipped depends on the removed endpoints.

This feature does two things: turns the rule into a CI-enforced property,
and removes the one endpoint that broke it.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A signed transaction can never reach the backend (Priority: P1)

A maintainer adding a new Powerup that accepts a signed transaction gets a
failing CI run with a message that points at the rule, before review.

**Why this priority**: The rule is the load-bearing statement in the
answer to Apple and to counsel; a property CI enforces is evidence, a
sentence in a doc is not.

**Independent Test**: Add a throwaway `router.post(...)` under
`src/routes/`, or a controller that mentions `signedTransaction`; the
boundary test fails naming the route file / controller file.

**Acceptance Scenarios**:

1. **Given** the route and controller sources on the branch, **When** the
   boundary test runs, **Then** it passes with the current route set.
2. **Given** a controller whose source mentions `signedTransaction`,
   `signedTx`, `rawTx` or `serializedTransaction`, **When** the test
   runs, **Then** it fails and names the file and the field.
3. **Given** a new `POST`/`PUT`/`PATCH`/`DELETE` route declared under
   `src/routes/**` (or on the app in `src/index.js`) that is not in the
   explicit allowlist, **When** the test runs, **Then** it fails and
   names the route.
4. **Given** an allowlist entry whose route no longer exists, **When**
   the test runs, **Then** it fails (the allowlist cannot go stale).

---

remains in the repo or the deploy config.

**Acceptance Scenarios**:

`not_found`. 2. **Given** the change, **When** `/ft/verified` and `/ft/search` are
called, **Then** they are unchanged (they share the router but not the 3. **Given** the rendered prod config, **When** inspected, **Then** no

---

### User Story 3 - Capability matrix stops advertising removed features (Priority: P2)

The `sections` matrix served by `/v1/networks` no longer lists `exchange`
client that obeys the matrix (frontend spec 027) keeps one switch for the
feature.

**Acceptance Scenarios**:

1. **Given** any stage, **When** `/v1/networks` is called, **Then**
   `sections.exchange` is absent for every network.
2. **Given** any stage, **When** `/v1/networks` is called, **Then**

### Edge Cases

- NFT burn and transfer are `POST` routes that **build unsigned**
  transactions — they stay in the allowlist with a reason saying why they
  are allowed (they return bytes, they never receive signed bytes); the
  test requires every reason to contain the word `UNSIGNED`.
- `POST /v1/events` (analytics) is a separate Lambda and is not mounted on
  the main app; the boundary test covers `src/routes/**` + `src/index.js`
  only, and the analytics payload allow-list already forbids transaction
  bytes.
- `jupiter-token-service`, `jupiter-service` (Price v3), `JUPITER_API_KEY`
  and `JUPITER_PRICE_URL` stay: `/ft/verified`, `/ft/search`, balance
  use them.
  history (`parser/parsers/jupiter.js`, `program-sources.js`) — that is
- The boundary test is a source scan, so a route declared with a
  computed path (`router.post(somePathVar, …)`) would not be seen. Every
  route in this repo is declared with a string literal; keep it that way.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: A unit test MUST scan every route file under `src/routes/**`
  and `src/index.js` for `router|app.<post|put|patch|delete>('<path>', …)`
  declarations and fail when a declared route is not in an explicit
  allowlist kept next to the test, each entry carrying `{ file, method, path, reason }`
  with a one-line reason. A stale allowlist entry MUST fail too.
- **FR-002**: The same test MUST fail when any controller source under
  `src/controllers/**` mentions a field name from the signed-transaction
  denylist (`signedTransaction`, `signedTx`, `rawTx`,
  `serializedTransaction`).
- **FR-003**: `AGENTS.md` MUST gain a "Signing boundary" rule stating that
  the backend never receives a private key, seed phrase or signed
  transaction, never broadcasts on a user's behalf, and that a Powerup's
  backend surface is quote → unsigned transaction → client signs → client
  broadcasts → backend reads status only.
  removed.
  `.env.example`, `jest.setup.js`, `scripts/ssm-put-params.sh` and any
  skill/doc; the plan lists the SSM parameters for ops to delete.
- **FR-006**: `sections.exchange` MUST be removed from every
- **FR-007**: `docs/openapi.yaml`, `docs/ARCHITECTURE.md`, root and nested
  `AGENTS.md`, and the `solana-rpc-context` skill MUST no longer describe
- **FR-008**: The full CI gate MUST pass.

### Key Entities

- **Mutating-route allowlist**: `{ file, method, path, reason }` entries
  (`file` relative to `src/`, `path` as declared on the router, not
  mount-prefixed); the only source of truth for which non-GET routes may
  exist.
- **Signed-transaction field denylist**: identifiers no controller source
  may contain.

## Success Criteria _(mandatory)_

- **SC-001**: The boundary test exists, passes on the resulting tree, and
  fails on a one-line injected violation (proved during implementation:
  the first commit on the branch adds the test red against
  green).
  returns nothing except the negative assertion in
  `src/routes/solana/__tests__/solana-ft-router.spec.js` (which checks
- **SC-003**: Unit, hermetic integration, `serverless print --stage local`
  and the OpenAPI parse pass.
- **SC-004**: `/ft/verified` and `/ft/search` specs pass unmodified.

## Assumptions

the build-only contract; deleting these endpoints does not affect the
submission build. Coordinated with the frontend session on 2026-09-02.
referral account itself keeps any accrued fees; it is an on-chain
account, not a parameter).

## Deviations from the written spec

Recorded 2026-09-10 against the implemented branch.

- **Static source scan instead of an Express route-table walk.** The
  test reads `src/routes/**` + `src/index.js` and matches
  `router|app.<method>('<path>'` literally; it never boots the app. Every
  route in the repo is declared that way, and the scan needs no mock of
  the chain-mount loop. Allowlist paths are therefore the router-local
  path (`/:mintAddress`), not the mounted one.
- **Field denylist is `signedTransaction, signedTx, rawTx, serializedTransaction`.**
  The bare `tx` from the draft was dropped (too many false positives in
  parser code) and so was the "`transaction` with a `signature`"
  heuristic. The check is a whole-word match on the controller source,
  not only on `req.body.<field>` reads.
  would have meant re-adding it on the same branch.
- **`DELETE` is in the mutating-method set** (draft said POST/PUT/PATCH).

## Out of scope

- Region allowlist and wallet screening — spec 011 (still a follow-up;
- Frontend changes — spec 027 in the frontend repo.
