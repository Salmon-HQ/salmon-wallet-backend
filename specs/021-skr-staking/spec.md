# Feature Specification: SKR staking position

**Feature Branch**: `019-token2022-nft-metadata` (spec dir `021-skr-staking`)

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "SKR Powerup, informational: liquid and staked balance, rewards earned and their history, the chosen guardian, days staked, price chart. No staking from Salmon."

## Context

SKR is Solana Mobile's token (mint `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`, SPL Token, 6 decimals). Holders stake it with a guardian through Solana Mobile's staking program `SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ`, whose Anchor IDL is published on chain. Rewards compound: a position holds `shares`, worth `shares × share_price / 10^9` SKR, and the share price rises each 48-hour epoch.

Verified on mainnet (2026-10-08) for `CzNRNm6vbDiJ2MG96Lw4gSZW1gSjeV6DgSEAjCULxXcJ`:

- `getProgramAccounts` on the program with the wallet at offset 41 (`dataSize: 169`) returns one `UserStake`: `shares` 40,000,000,000, `cost_basis` 1,000,000,000, guardian pool `DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr`.
- `StakeConfig` (`4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw`): `share_price` 1,151,142,678, `cooldown_seconds` 172,800.
- Value: 40,000,000,000 × 1.151142678 = 46,045.7 SKR — the 46,046 the Seed Vault Wallet shows. `cost_basis` is the share price paid (1.0), so the position earned 6,045.7 SKR on its 40,000 deposited.
- One guardian pool exists (the Solana Mobile Guardian, 0% commission). Pools carry no name on chain.

The program and the SKR token move thousands of transactions an hour, so a per-epoch history cannot be rebuilt from past transactions at request cost. The owner chose to record the share price from now on (2026-10-08).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - My SKR position (Priority: P1)

The user sees how much SKR is staked, with which guardian, how much it has earned, and any amount unstaking with the time it becomes withdrawable.

**Independent Test**: the endpoint for the wallet above answers 46,045.7 SKR staked, 6,045.7 earned, guardian "Solana Mobile Guardian", 0% commission.

**Acceptance Scenarios**:

1. **Given** a wallet with SKR staked, **When** its position is requested, **Then** each position carries the staked amount, the amount earned, the guardian (name when known, commission, active), and the unstaking amount with its withdrawable time when there is one.
2. **Given** a wallet without positions, **Then** an empty list with the global figures.
3. **Given** a network other than mainnet, **Then** 404 (the program exists on mainnet only).

### User Story 2 - History and pace (Priority: P2)

The user sees what the stake earned per recorded period and since when it is staked.

**Acceptance Scenarios**:

1. **Given** share prices recorded on several days, **When** the position is requested, **Then** `history` lists, newest first, the SKR earned between consecutive records for the current shares.
2. **Given** the position's own transactions are indexed by the provider, **Then** `stakedSince` is the time of its oldest one; otherwise null (Triton does not index the verified wallet's position address, so it reads null — known gap).
3. **Given** recorded prices spanning at least seven days, **Then** `apy` is their annualized growth; otherwise null.

### Edge Cases

- No record yet: `history` is empty and `apy` null; the earned total still shows (it needs no history).
- A pool not in the known-names list: `guardian.name` is null; its address shows.
- A stake made after some records: history only counts records since its oldest transaction.

## Requirements _(mandatory)_

- **FR-001**: `GET /v1/solana-mainnet/skr/stake?owner=` MUST answer the owner's positions read from the program's `UserStake` accounts, the `StakeConfig` share price, and each position's guardian pool.
- **FR-002**: Amounts MUST be base-unit integer strings (SKR has 6 decimals), computed in integer arithmetic.
- **FR-003**: Each request MUST record the current share price for the current UTC day if that day has no record (kept 400 days).
- **FR-004**: The response MUST carry `history`, `stakedSince`, `apy`, `sharePrice`, `cooldownSeconds`, and the SKR mint.
- **FR-006**: The response MUST carry `totalStaked`, everything staked in the program: `StakeConfig.total_shares × share_price / 10^9`, a base-unit string.
- **FR-005**: The endpoint is read-only: no stake, unstake or withdraw transaction is built.

## Success Criteria _(mandatory)_

- **SC-001**: The wallet above reads 46,045.7 SKR staked and 6,045.7 earned (±0.1).
- **SC-002**: After records on two different days, `history` has one entry.

## Assumptions

- `cost_basis` is the share price at which the position's shares were bought (scale 10^9), as the verified wallet shows; earned = `shares × (share_price − cost_basis) / 10^9`.
- Guardian names: the one documented pool is named from Solana Mobile's docs; others show their address until Solana Mobile publishes names.
- The holder benefits directory is out of scope until product names a source.
