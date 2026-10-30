# Quickstart: Dagon Powerup on devnet

How to prove the feature works, from unit tests to the staging stack. The device half (signing, sending, reveal read, settlement) belongs to the frontend; here a throwaway probe plays the device.

## Prerequisites

- Node 24 (`.nvmrc`), `npm ci`.
- A QA keypair file outside the repo (e.g. `~/.config/solana/dagon-qa.json`), its public key funded by Dagon with mock USDC and DOGE (`GUIDE.md` §10) and with devnet SOL from the standard faucet.
- The probe (`specs/023-dagon-powerup/probe/`, written in plan step 0) never lives under `src/`: it signs, and the backend never signs.

## 1. Task zero: v0 acceptance (FR-028)

```bash
node specs/023-dagon-powerup/probe/v0-probe.mjs --keypair ~/.config/solana/dagon-qa.json
```

Expected: one line per instruction kind `simulate v0 … ok`, then `send v0 setup … committed`, `wrap … committed`, `swap … committed`, `unwrap … released`. Record the outcome (and any legacy comparison) in `research.md` R1 before step 1 of the plan.

## 2. Unit gate

```bash
npm run format:check && npm run lint:check && npm run test:unit
```

All existing suites pass; the only edited existing assertions are the two exact lists that gain an entry (`src/analytics/__tests__/event-schema.spec.js:77`, `src/infrastructure/providers/__tests__/profiles.spec.js:20`). `src/__tests__/signing-boundary.spec.js` passes untouched.

## 3. Local run against devnet

```bash
NODE_ENV=local npm run serverless:start:local
# another shell
curl -s -H 'X-Salmon-Platform: ios' 'http://localhost:3000/v1/solana-devnet/powerups/availability' | jq '.data[] | select(.id=="dagon")'
# → { "id": "dagon", "enabled": true }
node specs/023-dagon-powerup/probe/drive.mjs --base http://localhost:3000 --keypair ~/.config/solana/dagon-qa.json --flow setup,wrap,reveal,swap,reveal
```

`drive.mjs` generates the fresh keypairs, calls the build route, checks the returned message (fee payer, signer set, programs), signs, sends, waits for the status byte, and for reveal performs the read the frontend will do (`encryptRead.ts`). Expected: the second reveal shows USDC down by the swap input and DOGE up (SC-001). Run `--flow unwrapBurn,unwrapDecrypt,unwrapComplete` once (SC-002).

Refusals to see once each: `setup` twice → 409 `already_initialized`; `freshSigners` with the owner key → 400 `invalid_fresh_signers`; `X-Salmon-Platform: extension` → 404; `solana-mainnet` → 404.

### Android emulator QA (by hand, no Maestro)

The local QA runs on the Android emulator against this local backend (owner decision 2026-10-30). `serverless-offline` listens on `0.0.0.0:3000` (`serverless.yml`), and the emulator reaches the host's loopback at `10.0.2.2`, so the demo app's API base URL points to `http://10.0.2.2:3000`. Check first from the host:

```bash
curl -s -H 'X-Salmon-Platform: android' 'http://localhost:3000/v1/solana-devnet/powerups/availability' | jq '.data[] | select(.id=="dagon")'
# → { "id": "dagon", "enabled": true }
```

Then run setup → wrap → reveal → swap → reveal by hand in the app, with a Dagon-funded QA wallet imported on the emulator.

## 4. Staging (the agent runs each step after warning the owner)

1. Availability row: dry run, show the owner the diff and warn, then write (`scripts/availability-table.mjs`):
   ```bash
   eval "$(aws configure export-credentials --format env)"
   node scripts/availability-table.mjs --stage staging   # prints the live table; save it (without the first "version" line) as ~/staging-table.json and add the dagon row from plan.md
   node scripts/availability-table.mjs --stage staging --file ~/staging-table.json
   node scripts/availability-table.mjs --stage staging --file ~/staging-table.json --execute
   ```
   The diff must show only added `dagon` lines; the `swap` row stays byte-for-byte.
2. Warn the owner, then deploy this branch (`docs/DEPLOY.md:26-33`): `npm run serverless:deploy:staging`.
3. Smoke against the execute-api URL the deploy prints:
   - `GET /v1/solana-devnet/powerups/availability` with `ios`, `android`, `extension` → dagon enabled / enabled / off (`maintenance`) (SC-005).
   - `GET /v1/solana-mainnet/powerups/availability` → no `dagon`; a partner-style `GET /v1/solana-mainnet/ft/swap/build` answers as before (SC-006).
   - `drive.mjs --base <staging url>` full flow, 10 swap builds timed (SC-003).
4. Removal after the demo: the next staging deploy from `staging` drops the code; remove the SSM row with the same script.
