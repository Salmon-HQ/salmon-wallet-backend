# Implementation Plan: SKR staking position

**Spec**: [spec.md](spec.md)

## Design

- **`src/services/solana/skr-staking-service.js`**
  - Constants: program, stake config, SKR mint, `SHARE_PRICE_SCALE = 10^9`, `KNOWN_GUARDIANS` (`DPJ58…` → "Solana Mobile Guardian", from docs.solanamobile.com).
  - Pure decoders for the Anchor accounts (layouts from the on-chain IDL, offsets after the 8-byte discriminator): `decodeUserStake`, `decodeStakeConfig`, `decodeGuardianPool`. u128/u64 read as BigInt.
  - `positionValues(stake, sharePrice)` — staked and earned in base units (BigInt).
  - `historyFrom(records, shares, since)` — SKR earned between consecutive daily records, newest first.
  - `apyFrom(records, now)` — annualized growth over the widest record span ≥ 7 days, else null.
  - `getSkrStake(owner, locals)` — `getProgramAccounts` (base64, `dataSize: 169`, memcmp offset 41), `getMultipleAccounts` (config + pools), records today's share price when the day has none, reads the last 30 days of records, `stakedSince` from each position's oldest signature (cached 30 days).
  - Records: `skr_share_price:<YYYY-MM-DD>` → `{ sharePrice, at }`, TTL 400 days, written only when absent.
- **Route** `src/routes/solana/solana-skr-router.js` mounted at `/skr`: `GET /stake?owner=` (`max-age=60`); 404 `not_found` outside `solana-mainnet`; 400 on a bad owner.
- **Resource** `src/resources/solana/solana-skr-stake-resource.js`: amounts as strings.

## Contract

New endpoint `solana-skr-staking` in `AGENTS.md`. Read-only.

## Verification

Decoders against the recorded mainnet bytes (46,045.7 staked, 6,045.7 earned); history/apy pure tests; controller tests; gates; live read.
