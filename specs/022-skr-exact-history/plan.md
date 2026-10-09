# Implementation Plan: SKR exact reward history

**Spec**: [spec.md](spec.md)

## Design

- **`skr-staking-service.js`**
  - `decodeStakeEvent(bytes)`: tag + discriminator → `{ kind, user, sharesDelta (signed BigInt), sharePrice }` for `Staked` (+minted), `Unstaked` (−unstaked), `UnstakeCancelled` (+restored); null for anything else.
  - `exactHistory(records, events, currentShares)`: price points (records and events) sorted by time; walked newest to oldest from the current shares, undoing each event's delta; each segment's earnings added to the UTC day it ends in; zero days dropped; newest first.
  - `ownerEvents(owner, since, locals)`: the owner's signatures back to `since` (pages of 1000), failed ones skipped; each transaction's events read once (`getTransaction`, inner instructions to the program) and cached under `skr_tx_events:<signature>` (400 days).
  - `recordSharePrice(now, locals)`: reads `StakeConfig` and writes the day's record when absent; used by the request path and the job.
  - `getSkrStake` answers `history` from `exactHistory` and `historySince`.
- **Job** `src/jobs/handler.recordSkrSharePriceJob` and a `serverless.yml` function on `cron(5 0 * * ? *)`, rule `recordSkrSharePriceJob-${stage}`.
- **`aws-deploy-policy.json`**: the new function and rule (applied to the live `GithubActionsPolicy` by the owner before the prod tag).

## Verification

Unit tests per seam; full unit suite; lint; staging deploy and a live read.
