# Implementation Plan: SOL stake accounts of a wallet

**Spec**: [spec.md](spec.md)

## Design

- **Route** `GET /:address/stakes` in `src/routes/solana/solana-account-router.js` (`cacheControl('max-age=60')`), controller `listStakes` in `solana-account-controller.js` (validates the address).
- **Service** `src/services/solana/stake-account-service.js`:
  - `listStakeAccounts(address, locals)` — two `getProgramAccounts` (jsonParsed, `dataSize: 200`, memcmp offset 12 / 44), deduped by pubkey; `getEpochInfo`; validator names; rewards.
  - `stakeState({ activationEpoch, deactivationEpoch }, epoch)` — pure.
  - `rewardsFor(accounts, epoch, locals)` — `getInflationReward` per completed epoch (last 5), one call per epoch for all accounts; each epoch's answer cached 30 days (`stake_rewards:epoch:<n>:<sorted accounts hash>`).
  - `validatorNames(locals)` — `getVoteAccounts` (vote → identity) + `getProgramAccounts(Config1111…, jsonParsed)` validator-info records (identity → `{ name, iconUrl }`), cached 24 h as one map.
- **Resource** `src/resources/solana/solana-stake-account-resource.js` — the public shape (FR-002), lamports as strings.
- RPC through `createBudgetedConnection(getRpcUrl(env), locals)` (Triton), like the NFT reads.

## Contract

New endpoint `solana-stake-accounts`, recorded in `AGENTS.md`. Additive.

## Verification

Unit tests on the pure state rule, the service (mocked connection, recorded mainnet shapes), the resource and the controller; gates; live read of the wallet in spec Context.
