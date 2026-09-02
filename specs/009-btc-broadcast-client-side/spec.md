# Feature Specification: Bitcoin broadcast from the client

**Feature Branch**: `009-btc-broadcast-client-side`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "Remove the backend Bitcoin broadcast relay; the wallet broadcasts signed transactions directly to a public endpoint"

## Context

Apple's 3.1.5(iii) questionnaire asks whether the developer handles
transaction requests directly. Today the backend receives a signed Bitcoin
transaction from the wallet and relays it to Blockdaemon
(`POST /v1/bitcoin-:env/account/:address/transactions`). Solana send, NFT
transfer/burn and dApp signing already broadcast from the device; Bitcoin
is the outlier. The wallet will post the raw signed transaction itself to a
public broadcast endpoint (mempool.space, blockstream fallback), which needs
no credential.

There is no user-facing regression: `AGENTS.md` records that Bitcoin send
does not work end to end today (P2PKH inputs need `nonWitnessUtxo`, which
Blockdaemon cannot supply). The frontend change is coordinated with the
frontend session and lands first.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The backend never receives a signed Bitcoin transaction (Priority: P1)

A client posting to the former broadcast route gets the standard 404
envelope; history and UTXO reads are unchanged.

**Acceptance Scenarios**:

1. **Given** the change, **When** `POST /v1/bitcoin-mainnet/account/:address/transactions` is called, **Then** the catch-all answers 404 `not_found`.
2. **Given** the change, **When** `GET …/transactions` and `GET …/utxo` are called, **Then** behaviour is byte-identical to today.

### Edge Cases

- The 502 `broadcast_status_unknown` outcome no longer exists; the wallet
  owns broadcast-outcome handling.

## Requirements _(mandatory)_

- **FR-001**: The broadcast route, controller action, service and their
  tests MUST be removed.
- **FR-002**: `docs/openapi.yaml`, `docs/ARCHITECTURE.md`, root and slice
  `AGENTS.md` MUST describe the Bitcoin slice as read-only and the
  `bitcoin-account-history` contract MUST drop the broadcast clause.
- **FR-003**: The full CI gate MUST pass.

## Success Criteria _(mandatory)_

- **SC-001**: `grep -rn broadcast src/services/bitcoin src/controllers/bitcoin src/routes/bitcoin` returns nothing.
- **SC-002**: Unit, hermetic integration and `serverless print` pass.

## Assumptions

- Frontend merges its client-side broadcast (mempool.space, testnet
  variant, blockstream fallback) before this backend removal is deployed.

## Out of scope

- Fixing Bitcoin send end to end (P2PKH `nonWitnessUtxo`) — separate decision recorded in `AGENTS.md`.
- Swap broadcast — later feature.
