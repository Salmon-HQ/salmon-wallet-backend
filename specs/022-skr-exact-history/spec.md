# Feature Specification: SKR exact reward history

**Feature Branch**: `022-skr-exact-history`

**Created**: 2026-10-09

**Status**: Draft

**Input**: DEV-87, option A (Nacho, 2026-10-09): the SKR reward history becomes exact from the day a scheduled task starts recording; earlier months are not rebuilt.

## Why the history is not exact today

`history` multiplies the position's current shares by the share-price growth between daily records (spec 021). It is wrong for any day before the owner staked, unstaked or cancelled an unstake, and the records exist only on days someone opened the Powerup, so a gap merges several days into one row.

## What makes it exact

- The share price on every day: a daily scheduled task records it.
- The owner's shares at every moment: the staking program emits an event on each change (`Staked.shares_minted`, `Unstaked.shares_unstaked`, `UnstakeCancelled.shares_restored`), each with the share price at that instant (IDL verified on chain, 2026-10-09). They are read from the owner's own transactions.

Between two consecutive price points (a daily record or an event), the owner held a known number of shares, so what they earned is `shares × (price_after − price_before) / 10^9`, exactly.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - An exact reward per day (Priority: P1)

The Powerup lists what the stake earned each day, newest first, exact even across a stake or unstake, from the first recorded day.

**Independent Test**: records on three days and a `Staked` event between the first two: the first day's row counts only the shares held before the event until it, and all shares after.

### User Story 2 - Since when (Priority: P2)

The response says from when the history is exact (`historySince`), so the app can label it.

### Edge Cases

- A day without growth (no rewards deposited) has no row.
- Events before the first record are not read.
- A transaction that failed is ignored.
- The owner's transactions cannot be read: the history is left out (empty) rather than inexact, and the rest of the read answers.

## Requirements _(mandatory)_

- **FR-001**: A scheduled function records the SKR share price once per UTC day (mainnet), on the same keys the request path writes (`skr_share_price:<day>`, 400 days).
- **FR-002**: `history` is computed from the price records and the owner's staking events since the earliest record of the window, as above; days with no growth are left out.
- **FR-003**: The response carries `historySince` (epoch ms of the earliest record used), or null without records.
- **FR-004**: Events are decoded from the program's self-CPI event instructions (Anchor `emit_cpi`, tag `e445a52e51cb9a1d`) in the owner's transactions; each transaction's events are cached for good (a confirmed transaction never changes).
- **FR-005**: The endpoint stays read-only.
- **FR-006**: The response carries `payouts` — `intervalSeconds`, `lastAt`, `nextAt` — read from the SKR inflation program's state account (interval, start, payouts made), so the app can say when the next payout is due from the program's own schedule.
- **FR-007**: The scheduled function runs at 02:05 UTC, just after the 02:00 payout, and replaces the day's record, so each record closes on a payout.

## Success Criteria _(mandatory)_

- **SC-001**: Pure tests: event decoding against recorded mainnet bytes; history across a stake, an unstake and a cancel, matching hand-computed values.
- **SC-002**: The scheduled function records today's price once, and a second run the same day writes nothing.
- **SC-003**: Live read on staging returns `historySince` and history rows for the recorded wallet.

## Assumptions

- The owner's address appears in every transaction that changes its shares (it is an account of `stake`, `unstake` and `cancel_unstake`), so its signature list covers them.
- Prod deploys the scheduled function only after the CI role's policy allows its rule and function (manual IAM step, owner-approved).
