# Feature Specification: Solana v1 (4096-byte) transactions

**Feature Branch**: `dev-42-prepare-salmon-for-solana-v1-and-4096-byte-transactions`

**Created**: 2026-09-08

**Status**: Implemented (backfilled — written after the work, from Linear DEV-42)

**Input**: Linear DEV-42 "Prepare Salmon for Solana v1 and 4096-byte transactions"

## Context

Solana is raising the maximum transaction size from 1232 to 4096 bytes via
SIMD-0296 and a new transaction format, version `1`. Reading a block or a
transaction that contains a v1 transaction is a breaking change for any
client that has not opted in: the RPC answers error `-32015` for the whole
page. Sending v1 is opt-in. The feature is active on devnet and testnet;
mainnet activation is expected with Agave v4.2.

Salmon has two consumers of this change:

- the wallet (`../salmon-wallet-frontend`), which must decode, preview, sign
  and send v1 transactions that dApps and integrations hand it, and — as a
  security requirement — must refuse to sign a v1 transaction message through
  the raw `signMessage` path (the "transaction lookalike" guard);
- this backend, which reads transaction history from Triton, Helius and a
  bare RPC fallback, all of which must keep advancing past the first v1 slot.

Building v1 transactions in Salmon is explicitly out of scope: receiving and
safely signing them is required; building them is required only for a
concrete flow that benefits from the larger envelope, and none does today.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - History keeps loading after mainnet activates v1 (Priority: P1)

A wallet user's transaction history contains a v1 transaction. Every history
reader (Triton, bare RPC) returns the page instead of failing.

**Acceptance Scenarios**:

1. **Given** a history page containing a v1 transaction, **When** Triton is queried, **Then** the request carries the integer `maxSupportedTransactionVersion: 1` and the page is returned and parsed.
2. **Given** Triton and Helius are unavailable, **When** the bare RPC fallback runs, **Then** it also opts into v1 and the parsed response (with `version: 1`) is accepted, not rejected by the client library.

### User Story 2 - A dApp cannot smuggle a v1 transaction through `signMessage` (Priority: P1, frontend)

A dApp asks the raw `signMessage` path to sign bytes that are a valid v1
transaction message. The wallet refuses before the private key is used.

**Acceptance Scenarios**:

1. **Given** a canonical v1 compiled message, **When** it reaches `approveSolanaSignMessage`, **Then** `TransactionLookalikeMessageError` is thrown and nothing is signed.
2. **Given** legacy and v0 messages, **Then** behaviour is unchanged (pinned by the classification corpus).

### User Story 3 - The wallet signs, previews and sends v1 (Priority: P1, frontend)

A dApp sends a v1 transaction (up to 4096 bytes, possibly partially signed by
a co-signer) through Wallet Standard or the injected provider.

**Acceptance Scenarios**:

1. **Given** a v1 message, **When** approval details load, **Then** fee, instruction count, fee payer, blockhash and the v1 `transactionConfig` (compute limit, loaded-accounts limit, priority fee in total lamports) are shown.
2. **Given** a partially signed v1 transaction, **When** the wallet signs and sends it, **Then** the co-signer signature is preserved byte-for-byte, the wallet signature verifies against the exact message bytes, and the submission is base64.
3. **Given** a v1 transaction larger than 1232 bytes and no larger than 4096, **When** previewed, **Then** it is simulated over base64.
4. **Given** a transaction that would exceed 4096 bytes, or whose version this build cannot decode, **When** previewed or signed, **Then** the wallet reports "cannot determine effects" / "unsupported version" and refuses to sign — never an empty preview.

### Edge Cases

- Wallet Standard's `SolanaTransactionVersion` type does not yet include `1`; the wallet advertises `['legacy', 0, 1]` through a cast.
- A v1 message with no resource limits is still a valid transaction message (the cluster rejects it at execution); the wallet reports an empty config rather than inventing defaults.
- Jupiter Ultra's `/order` could not be probed (HTTP 500 during this work); the wallet validates version/config itself and treats every transaction source as untrusted.

## Requirements _(mandatory)_

- **FR-001**: Every backend RPC transaction reader MUST pass the integer `maxSupportedTransactionVersion: 1`.
- **FR-002**: The bare-RPC fallback MUST accept `version: 1` in a parsed transaction (`@solana/web3.js` ≥ 1.99.0-beta.0, read-only).
- **FR-003**: The wallet MUST decode, preview, sign, re-encode and send v1 transactions, and MUST refuse v1 bytes on the raw `signMessage` path (frontend PR).
- **FR-004**: Legacy and v0 behaviour MUST remain byte-identical (golden vectors and the classification corpus stay green).
- **FR-005**: Backend and frontend deterministic CI gates MUST pass.

## Success Criteria _(mandatory)_

- **SC-001**: `grep -rn "maxSupportedTransactionVersion: 0" src` returns nothing.
- **SC-002**: Unit suite passes on `@solana/web3.js` 1.99.0-beta.0; a `version: 1` parsed transaction goes through the parser unchanged.
- **SC-003**: Frontend: canonical v1 message is rejected by `signMessage`; v1 sign/send/preview tests pass; live devnet simulation of a >1232-byte v1 transaction returns effects.

## Assumptions

- Helius Enhanced API parses on Helius's side; no version parameter is sent.
- No Geyser/gRPC consumer exists in either repo.
- Backend readers do not surface compute or priority settings, and `meta.fee` already includes the v1 priority fee, so nothing reads `transactionConfig` on the backend.
