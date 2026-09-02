# Feature Specification: Drop `@solana/spl-token`

**Feature Branch**: `006-drop-spl-token`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "Remove @solana/spl-token: inline its four used symbols so bigint-buffer leaves the dependency tree"

## Context

The only production security-audit finding left after the 2026-09-02
hardening is `bigint-buffer` (GHSA-3gc7-fjrx-p6mg, high, availability-only).
It has no patched release and upstream declined to fix it. It reaches this
repo through exactly one path: `@solana/spl-token` → `@solana/buffer-layout-utils`
→ `bigint-buffer`.

The backend uses four symbols from `@solana/spl-token` — two program-id
constants, one associated-token-address derivation, and one "close account"
instruction builder — none of which touch the vulnerable numeric codecs. The
repo already hand-rolls the same address derivation elsewhere. Replacing those
four symbols with local code removes the package, and with it the advisory,
without adding any dependency.

An earlier hypothesis — migrate `@solana/web3.js` 1.x to `@solana/kit` — was
assessed and rejected for now: web3.js is not the source of the advisory, and
the Metaplex umi stack still requires web3.js 1.x (no kit-native umi bundle
exists). That assessment is recorded in `research.md`.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - NFT burn and transfer keep producing identical transactions (Priority: P1)

A wallet user burning an NFT (edition, master, pNFT, cNFT) or transferring a
programmable NFT receives an unsigned transaction whose bytes are identical to
what the backend produced before the change, so signing and on-chain
execution behave exactly as today.

**Why this priority**: These are the two highest-risk services in the repo and
the only places the removed symbols shape transaction bytes. A wrong byte
fails at the wallet's signing step or on chain, not in our logs.

**Independent Test**: Golden-vector tests pin the base64 wire transaction for
each affected path with a fixed blockhash; they must pass byte-for-byte
before and after.

**Acceptance Scenarios**:

1. **Given** an edition NFT owned by a wallet, **When** a burn transaction is
   requested, **Then** the returned wire bytes equal the pinned golden vector.
2. **Given** a programmable NFT and a destination address (including one that
   is not on the ed25519 curve, e.g. a PDA), **When** a transfer transaction
   is requested, **Then** the derived destination token account and the wire
   bytes equal the pinned golden vector.
3. **Given** a master edition NFT, **When** burned, **Then** the existing
   equivalence test still passes unchanged.

---

### User Story 2 - Token-account discovery is unchanged (Priority: P1)

Balance, NFT listing and address enrichment continue to find the same token
accounts for a wallet on both the classic Token program and Token-2022.

**Why this priority**: Two of the removed symbols are the program ids used to
filter token accounts; a typo silently returns empty balances.

**Independent Test**: Existing provider and address-service unit tests pass
with the program ids asserted as string literals.

**Acceptance Scenarios**:

1. **Given** a wallet with classic SPL token accounts, **When** balances are
   requested, **Then** the same accounts are returned as before.
2. **Given** a wallet with Token-2022 accounts, **When** NFTs are listed via
   DAS, **Then** the same accounts are returned as before.

---

### User Story 3 - Production audit is clean (Priority: P2)

Maintainers see zero production-scope findings in the dependency audit and the
`bigint-buffer` exception removed from `SECURITY.md`.

**Why this priority**: The repo is going public; a documented exception is
acceptable, a clean report is better and cheap here.

**Independent Test**: `npm audit --omit=dev` reports no vulnerabilities;
`npm ls bigint-buffer` is empty.

**Acceptance Scenarios**:

1. **Given** the change, **When** the production audit runs, **Then** it
   reports zero findings.
2. **Given** the change, **When** `SECURITY.md` is read, **Then** the
   `bigint-buffer` exception row is gone and nothing else changed.

---

### Edge Cases

- A destination address for a pNFT transfer that is off-curve (PDA or
  multisig): the derivation must still succeed — the library flag
  `allowOwnerOffCurve=true` was being passed, and program-address derivation
  never checks the curve, so behaviour is preserved by construction. Covered
  by a golden vector.
- Token-2022 program id must be exact: asserted by literal in tests.
- The close-account instruction must carry the same three accounts in the
  same order with the same writable/signer flags and the single-byte
  discriminator `9`; pinned by the burn golden vector.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST produce byte-identical unsigned transactions for
  edition burn, master-edition burn and programmable-NFT transfer compared to
  the pre-change implementation, for the same inputs and blockhash.
- **FR-002**: The system MUST derive associated token accounts identically to
  the removed library, including for off-curve owners.
- **FR-003**: The system MUST use the exact Token and Token-2022 program ids
  when filtering token accounts.
- **FR-004**: `@solana/spl-token` MUST be absent from the dependency manifest
  and lockfile; no replacement package may be added.
- **FR-005**: The production dependency audit MUST report zero findings, and
  the corresponding exception in `SECURITY.md` MUST be removed.
- **FR-006**: Every public endpoint contract listed in `AGENTS.md` MUST be
  unchanged (`solana-nft-burn`, NFT transfer, `solana-nft-listing`,
  `multichain-account-balance`).
- **FR-007**: Golden-vector tests for the affected transaction paths MUST be
  captured from the current implementation **before** any source change and
  MUST NOT be regenerated to make a diff pass.

### Key Entities

- **Program id constant**: base58 address of the Token program and the
  Token-2022 program.
- **Associated token account**: program-derived address from (owner, token
  program, mint) under the associated-token program.
- **Close-account instruction**: Token-program instruction with discriminator
  `9`, accounts `[account (writable), destination (writable), authority (signer)]`.
- **Golden vector**: base64 wire transaction pinned with a fixed blockhash and
  fee payer, used as the acceptance oracle.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of pinned golden vectors (edition burn, master-edition
  burn, pNFT transfer incl. off-curve destination) pass unchanged.
- **SC-002**: `npm audit --omit=dev` reports 0 vulnerabilities.
- **SC-003**: `npm ls bigint-buffer` and `npm ls @solana/spl-token` are empty.
- **SC-004**: Zero new packages in the lockfile.
- **SC-005**: The full unit suite and the CI gate pass; post-deploy error rate
  on NFT burn/transfer routes is unchanged over 24 h.

## Assumptions

- The four symbols are the entire live surface of the package (verified by
  grep on 2026-09-02: four import sites, three test mocks).
- The `findAssociatedTokenAddress` derivation already in
  `solana-address-service.js` is correct and equivalent to the library's; the
  golden vector for the pNFT transfer proves it.
- No wallet-client change: the wallet receives base64 transactions and
  base58 strings; nothing in the response shapes references the package.

## Out of scope

- Migrating `@solana/web3.js` to `@solana/kit`. Blocked on Metaplex umi
  shipping a kit-native bundle; decision and triggers recorded in
  `research.md`.
- Replacing `@solana/spl-token-registry` — feature 005.
