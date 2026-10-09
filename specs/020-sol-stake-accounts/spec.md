# Feature Specification: SOL stake accounts of a wallet

**Feature Branch**: `019-token2022-nft-metadata` (spec dir `020-sol-stake-accounts`)

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "Show the wallet's SOL stake accounts in a Staking tab next to Portfolio and NFTs: how much is staked, with which validator, its state, and what each epoch paid."

## Context

A stake account is a separate account that holds SOL delegated to a validator; the wallet holds the authority to manage it. Salmon shows none of them today, so a user who staked elsewhere (the Seeker's own wallet, a website) does not see that SOL in Salmon at all.

Verified on mainnet (2026-10-08) for `CzNRNm6vbDiJ2MG96Lw4gSZW1gSjeV6DgSEAjCULxXcJ`: `getProgramAccounts` on the Stake program with `dataSize: 200` and the wallet at offset 12 (staker) or 44 (withdrawer) returns its one stake account (1.0025 SOL, voter `Sa1HXZ…`, activation epoch 1046); `getInflationReward` answers the reward of each epoch since activation (epoch 1051: 169,992 lamports).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See my stake accounts (Priority: P1)

The user opens the Staking tab and sees each of the wallet's stake accounts: SOL amount, validator, state (activating, active, deactivating, inactive), and the total staked.

**Independent Test**: request the endpoint for the wallet above: one item with its amount, the voter, `active`, and the validator's published name when it has one.

**Acceptance Scenarios**:

1. **Given** a wallet that is the staker or the withdrawer of stake accounts, **When** they are listed, **Then** each appears once, with lamports, delegated lamports, voter, validator name and icon when published, activation and deactivation epochs, and state.
2. **Given** a wallet with no stake accounts, **Then** the list is empty (200).
3. **Given** an invalid address, **Then** 400 `bad_request`.

### User Story 2 - What each epoch paid (Priority: P2)

For each stake account, the user sees the reward of the last epochs (amount and epoch).

**Acceptance Scenarios**:

1. **Given** an active stake account, **When** listed, **Then** it carries the rewards of the last 5 completed epochs it was active in (epoch, lamports, post-balance).
2. **Given** an epoch the provider cannot answer, **Then** that epoch is left out, never invented.

### Edge Cases

- A stake account that is initialized but never delegated: listed with state `inactive` and no validator.
- The validator never published a name: `validator` is null; the voter address stays.
- The provider refuses `getProgramAccounts`: the request fails through the existing resilience errors (503), never an empty "you have no stakes".

## Requirements _(mandatory)_

- **FR-001**: `GET /v1/solana-{env}/account/:address/stakes` MUST list every stake account whose staker or withdrawer authority is `address`, deduplicated.
- **FR-002**: Each item MUST carry `address`, `lamports`, `delegatedLamports`, `voter`, `validator` (`{ name, iconUrl }` or null), `activationEpoch`, `deactivationEpoch` (null when not deactivating), `state`, `rewards` (`[{ epoch, lamports, postBalance }]`, newest first).
- **FR-003**: The response MUST carry the current `epoch`.
- **FR-004**: Rewards of completed epochs MUST be cached (they never change); validator names cached for a day.
- **FR-005**: The endpoint is read-only and builds no transaction.
- **FR-006**: The response MUST carry `logo`, SOL's image from the token catalog, or null when the catalog cannot give one; a missing logo never fails the read.

## Success Criteria _(mandatory)_

- **SC-001**: The wallet above lists its stake account with amount, validator and `active`, matching the explorer.
- **SC-002**: A repeated request within the same epoch makes no new reward reads.

## Assumptions

- State is decided from activation/deactivation epochs against the current epoch. Cluster-wide warm-up limits can stretch activation over several epochs; the rare account caught in that window reads `active` one epoch early (documented ceiling).
- Validator names and icons come from the validator-info records validators publish on chain; many validators publish none.
