# Feature Specification: Replace the archived SPL Token Registry

**Feature Branch**: `005-replace-spl-token-registry`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "Replace the archived @solana/spl-token-registry dependency: the devnet/testnet fallback branch of getTokenList() in src/services/solana/solana-ft-service.js is its only consumer; serve those cluster token lists from the same solana-labs jsDelivr CDN JSON already used by cdn-token-list-service (filtered by chainId 101/102/103), preserve the /ft/verified and /ft/search contract unchanged, and remove the npm dependency and its cross-fetch override."

## Context

The backend labels SPL token transfers (symbol, name, decimals, logo) in
transaction history and balance responses using a per-network token list.
For mainnet that list comes from Jupiter. For devnet and testnet it comes
from a snapshot embedded in the `@solana/spl-token-registry` package, whose
upstream repository was archived in July 2024. The package is unmaintained,
pins an outdated HTTP client that the repo has to override for a security
advisory, and is the last reason that override exists.

The same snapshot is published as a static JSON file on a public CDN, and the
backend already fetches that file elsewhere (the verified-token fallback).
Verified on 2026-09-02: the CDN file yields exactly the same per-cluster
token counts as the package (mainnet 13053, testnet 62, devnet 529).

The public token-catalog endpoints (`/ft/verified`, `/ft/search`) do **not**
use this package — they already run on Jupiter with the CDN as fallback.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Devnet/testnet transfers stay labelled (Priority: P1)

A wallet user browsing their transaction history or balances on Solana
devnet or testnet continues to see token symbols, names and logos on SPL
transfers exactly as today, after the archived package is removed.

**Why this priority**: This is the only user-visible behaviour the package
provides. Losing it turns every devnet SPL transfer into an unlabelled row.

**Independent Test**: Request transaction history for a devnet address that
holds well-known devnet tokens before and after the change; the labelled
rows are identical.

**Acceptance Scenarios**:

1. **Given** a devnet address with SPL transfers, **When** its transaction
   history is requested, **Then** each transfer carries the same
   symbol/name/decimals/logo as before the change.
2. **Given** a testnet address, **When** its balance is requested, **Then**
   token rows are labelled with the same metadata as before the change.
3. **Given** a mainnet address, **When** history or balance is requested,
   **Then** behaviour is unchanged (mainnet never used the package).

---

### User Story 2 - Public token catalog is untouched (Priority: P1)

Wallet clients calling the verified-token list and token search endpoints
receive byte-identical response shapes and the same data sources as before.

**Why this priority**: These endpoints are a documented public contract
(`solana-fungible-token-catalog`); deployed wallets parse them.

**Independent Test**: Existing contract tests for `/ft/verified` and
`/ft/search` pass without modification.

**Acceptance Scenarios**:

1. **Given** the change is deployed, **When** `/ft/verified` is called,
   **Then** the response shape and field semantics are unchanged.
2. **Given** the change is deployed, **When** `/ft/search` is called,
   **Then** the response shape and field semantics are unchanged.

---

### User Story 3 - Dependency and override removed (Priority: P2)

Maintainers see the archived package gone from the dependency manifest and
the security-advisory override that existed only for it removed, with the
production vulnerability audit no worse than before.

**Why this priority**: The repo is going public; every unmaintained
dependency is supply-chain surface and reviewer noise.

**Independent Test**: The dependency manifest no longer lists the package;
the audit report contains no new findings.

**Acceptance Scenarios**:

1. **Given** the change, **When** dependencies are inspected, **Then** the
   archived package is absent and the override that existed solely for it is
   gone.
2. **Given** the change, **When** the production audit runs, **Then** the
   set of findings is a subset of the current set.

---

### Edge Cases

- The CDN is unreachable or answers an error while loading a devnet/testnet
  list: the request fails visibly with the standard error envelope, nothing
  is cached, and the next request retries. An empty list is never returned
  as if it were the truth (repo rule: never answer 200 with degraded data).
- An unknown network environment is requested: the list loader rejects it
  rather than silently returning mainnet data.
- The CDN file changes shape (missing cluster identifier): entries without a
  recognised cluster are excluded; the failure surfaces in tests before it
  reaches users.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST provide devnet and testnet token metadata
  (address, symbol, name, decimals, logo, tags, external price-id) from the
  publicly hosted token-list snapshot, filtered to the requested cluster.
- **FR-002**: Metadata returned for a given cluster MUST be equivalent to
  what the archived package returned for that cluster (same entries, same
  fields).
- **FR-003**: Mainnet token labelling MUST remain on its current source and
  be unaffected.
- **FR-004**: The `/ft/verified` and `/ft/search` endpoints MUST be
  unchanged in shape, semantics and data sources.
- **FR-005**: A failure to load a cluster list MUST propagate as an error
  response; it MUST NOT be converted into an empty list or a partial
  response.
- **FR-006**: Existing caching behaviour for per-network token lists (cache
  lifetime, de-duplication of concurrent loads) MUST be preserved.
- **FR-007**: The archived package MUST be removed from the dependency
  manifest, together with any override whose only purpose was that package.
- **FR-008**: Prose references to the archived package in repo docs, skills
  and test comments MUST be updated so they do not describe removed code.

### Key Entities

- **Token metadata entry**: one fungible token on one cluster — address,
  symbol, name, decimals, logo URL, tags, optional external price identifier,
  cluster identifier.
- **Cluster token list**: the set of token metadata entries for one network
  environment (mainnet, testnet, devnet), cached per environment.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of devnet/testnet SPL transfers that were labelled before
  the change are labelled identically after it (verified against a fixed
  sample of addresses).
- **SC-002**: Zero changes to the public token-catalog contract: all
  existing contract tests pass unmodified.
- **SC-003**: The archived package is absent from the dependency manifest and
  the production audit shows no new findings.
- **SC-004**: When the list source is unavailable, affected requests fail
  with the standard error envelope within the existing request timeout, and
  no request answers success with an empty token list.
- **SC-005**: The full unit suite and the touched integration suite pass.

## Assumptions

- Devnet and testnet token metadata is a frozen snapshot regardless of
  source; this change removes a dependency, it does not make devnet labels
  fresher. No provider offers a maintained devnet/testnet catalog.
- The public CDN copy of the snapshot remains available; it is the same
  artefact the backend already relies on for the verified-token fallback.
- No wallet client change is required; the frontend never consumed the
  package directly and reads only the fields listed in FR-001.
- No new secrets or configuration are needed; the CDN is public.

## Out of scope

- The mainnet list source currently downloads a very large payload on every
  cold cache miss. That is a separate operational problem and is deliberately
  not addressed here; it deserves its own feature.
- Providing fresh devnet/testnet metadata via per-mint lookups.
