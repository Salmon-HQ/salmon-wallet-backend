# Tasks: Dagon Powerup (devnet preview)

**Input**: `specs/023-dagon-powerup/` — [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/dagon-build.md](contracts/dagon-build.md), [quickstart.md](quickstart.md). Branch `feat/dev-93-dagon-powerup` (never merged; staging only). Linear DEV-93.

**Order**: phases follow the plan's work order (steps 0 → 15) exactly. Inside every step the failing tests come first, then the implementation, then `npm run test:unit -- <touched specs>`. One commit per step; the supervising agent commits and pushes (no PR, never merged).

**Tests**: required (plan "Work order (backend test-first)"). Every unit spec is hermetic (mocked `providerCall` / `Connection`, no `.env`). The devnet proofs are probe scripts under `specs/023-dagon-powerup/probe/`, never under `src/`, because they sign with a QA key.

## Format

`- [ ] T# [P?] [Story?] [OWNER?] Description (file paths) — FR/SC`

- **[P]**: different file and no dependency on an unfinished task.
- **[US1]…[US5]**: user story from spec.md (US1 setup/wrap/reveal, US2 swap, US3 send, US4 unwrap, US5 nothing else changes).
- **[OWNER]**: needs an owner action (funds, credentials, a go after a warning). The agent stops at that task until the owner answers.

Adapter folder shorthand: `ADP` = `src/services/solana/powerups/adapters/dagon/`, `ADT` = `src/services/solana/powerups/adapters/__tests__/`.

## Phase 1: Setup — step 0, v0 proof on devnet (FR-028)

**Purpose**: prove Dagon's executor processes a v0 transaction before any `src/` change, and prove the hand-encoded `createInput`. Outcome decides whether step 2b runs.

- [ ] T001 [OWNER] Owner provides a QA keypair file outside the repo (for example `~/.config/solana/dagon-qa.json`), its public key funded by Dagon with mock USDC and DOGE and with devnet SOL from the faucet; the agent never creates, prints or commits that key — FR-028, quickstart prerequisites
- [ ] T002 Write `specs/023-dagon-powerup/probe/v0-probe.mjs`: inline builders transcribed from research R6, PDA seeds from `GUIDE.md:85-96`, hand-encoded gRPC-web `createInput` from R3 (91-byte message + 5-byte frame), `--keypair <path>` argument, reads `devnet.json` from the pinned URL; prints one line per check, never a key or secret — FR-028
- [ ] T003 Run the simulate half: one v0 message per kind (create_deposit + InitializeAccount, Wrap, ViewBalance, Transfer, Swap, UnwrapBurn); expect `simulate v0 … ok` per kind — FR-028
- [ ] T004 Run the send half with the QA wallet: v0 setup → balance `data[99] == 1`; wrap 1.00 → digest change and status 1; swap 0.10 → both balances commit; one unwrap end to end (burn → decrypt → complete, SPL rises). Pass = every output ciphertext commits within 90 s; this also proves `createInput` against the live executor — FR-028, SC-002 (first evidence)
- [ ] T005 Only if T004 fails for v0: repeat one wrap as legacy in `specs/023-dagon-powerup/probe/v0-probe.mjs`. Legacy commits and v0 does not → step 2b applies; both fail → executor outage, retry later, do not start step 2b — FR-028
- [ ] T006 Write the outcome (per-kind result, timings, legacy comparison if run, 2b decided yes/no) into `specs/023-dagon-powerup/research.md` R1 — FR-028

**Checkpoint**: R1 records the result; step 2b is decided.

## Phase 2: Foundational — shared signer machinery and adapter building blocks (steps 1–7)

**Purpose**: the only two shared-code edits (signers in the compile result, relaxed signer check with its negative tests), the two provider profiles, and the three pure-ish adapter modules plus `validate`. Every user story depends on this phase.

### Step 1 — `signers` in `compileUnsigned`

- [x] T007 Tests first in `src/services/solana/powerups/__tests__/unsigned-transaction-builder.spec.js`: payer-only message → `signers` = `[payer]`; two-signer message → payer first, then the co-signer; `requiredSignatures` unchanged — FR-009
- [x] T008 Add `signers: simulated.staticAccountKeys.slice(0, simulated.header.numRequiredSignatures).map((k) => k.toBase58())` to the result in `src/services/solana/powerups/unsigned-transaction-builder.js` (around `:270-276`); additive, Swap keeps reading only `requiredSignatures`; run the builder spec and `src/services/solana/swap/__tests__/` — FR-009, FR-026

### Step 2 — relaxed signer check, negative tests early

- [ ] T009 [US5] Tests first in `src/services/solana/powerups/__tests__/powerup-build-service.spec.js`; mock registry gains a `fresh-fixture` entry with `freshSigners: { act: 1, none: 0 }`. Positive: `solana-devnet` + signer set exactly `{publicKey, fresh}` → 200. Negatives, each 502 `provider_signer_mismatch` with no bytes: same message on `solana-mainnet`; entry without `freshSigners` + two signers (existing test stays as is); fresh key missing; extra key; fresh key swapped for another key; owner absent / not first; declared count ≠ supplied count; action declaring 0 with one fresh key supplied. Plus: an undeclared top-level program in a `fresh-fixture` build → 502 `provider_program_mismatch`; the mismatch log line carries `{ powerup, requiredSignatures }` and never a fresh key — FR-009, FR-010, FR-011, FR-025, SC-004
- [ ] T010 [US5] Replace `assertSingleSigner` with `assertSigners(id, built, expected)` in `src/services/solana/powerups/powerup-build-service.js` (`:77-89`, call site `:110-131`): `declared = entry.freshSigners?.[validated.params.action] ?? 0`; `fresh` = `validated.params.freshSigners` only when `declared > 0`, `locals.network.id === 'solana-devnet'` and the lengths match, else `[]`; pass iff `requiredSignatures === expected.length`, `signers[0] === publicKey` and same set; same `PowerupSignerMismatchError` and log. Run `powerup-build-service.spec.js`, `memo.spec.js` and the existing suites unchanged — FR-009, FR-010, FR-026

### Step 2b — legacy mode (only if T006 says so; otherwise mark both skipped)

- [ ] T011 Tests first in `src/services/solana/powerups/__tests__/unsigned-transaction-builder.spec.js` and `powerup-build-service.spec.js`: `legacy` option produces bytes that deserialize as a legacy transaction with the same programIds and signers; memo build in the service stays v0 — FR-028, FR-026
- [ ] T012 Add the `legacy` option (`compileToLegacyMessage()`, no lookup tables) to `src/services/solana/powerups/unsigned-transaction-builder.js` and pass it from `src/services/solana/powerups/powerup-build-service.js` only for an entry with `legacyTransaction: true` (set on `dagon` in T034) — FR-028

### Step 3 — provider profiles

- [ ] T013 Tests first in `src/infrastructure/providers/__tests__/profiles.spec.js`: the exact name list (`:20`) gains `encrypt-executor` and `dagon-config`; `getProfile` shape for both (no retry, default breaker); every existing profile unchanged — FR-023, FR-027
- [ ] T014 Add `'encrypt-executor': { tier: () => ({ rps: 5, burst: 10 }), timeoutMs: 5000, retry: RETRY_NONE, breaker: BREAKER_DEFAULT }` and `'dagon-config': { tier: () => ({ rps: 1, burst: 5 }), timeoutMs: 3000, retry: RETRY_NONE, breaker: BREAKER_DEFAULT }` to `src/infrastructure/providers/profiles.js` — FR-023, FR-027

### Step 4 — `config.js` (`devnet.json` trust and cache)

- [ ] T015 [P] Add fixture `ADT/fixtures/dagon-devnet-epoch2.json` (copy of the kit's epoch 2 `devnet.json`) — FR-012
- [ ] T016 Tests first in `ADT/dagon-config.spec.js` (mocked `providerCall`, fake clock): epoch 2 fixture accepted; refused, logged `[DAGON_CONFIG]` with a reason and never the body, each answering 503 `dagon_config_unavailable` with no cached copy: malformed JSON, `cluster` ≠ `devnet`, `pcToken` / `pcSwap` / `encrypt` id ≠ pinned, non-`https` executor URL, executor host ≠ `pre-alpha-dev-1.encrypt.ika-network.net`, bad `networkKeyHex`, non-integer `fheTypeU64`, invalid base58 in `sides` or `pool`, `pool.sideA`/`sideB` not two distinct known sides; last good copy kept on a fetch failure and on a refused copy; a new epoch with the same programs replaces the cached copy; cache served for 5 minutes then refreshed; the remote `layout` block and `rpcEndpoint` are ignored — FR-012, FR-013, FR-014, FR-015, SC-004
- [ ] T017 Implement `ADP/config.js`: pinned ids exported here (pc-token `3kjJEx6G1XdrtixFg9f8eGRAyzW5QmhsJQq6qCUZYhXZ`, pc-swap `BqJMtWQYiis1264KqBN3wssNqTofK5RuP67hkZYvb4SD`, Encrypt `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`) so `index.js` and the registry re-use one constant without a circular import; `getConfig(locals)` via `axios.get` inside `providerCall('dagon-config', …, { locals })`; module-memory cache with `fetchedAt`; throws `PowerupError(…, 503, 'dagon_config_unavailable')` with none; logs through `toSafeError` / `toOrigin` — FR-012 to FR-015, FR-025, FR-027

### Step 5 — `executor.js` (`createInput` + wait)

- [ ] T018 Tests first in `ADT/dagon-executor.spec.js`: request body equals the hand-derived 91-byte message + 5-byte frame for a fixed value, program and network key; headers `application/grpc-web+proto`, `x-grpc-web: 1`; parse data + trailer frames and a trailers-only answer; exactly one 32-byte id → `PublicKey`; zero ids, two ids, garbage, other non-zero `grpc-status` → 502 `executor_bad_response`; HTTP 5xx, network error, open breaker, `grpc-status` 14 or 4 → 503 `executor_unavailable`; parallel calls for three values; `waitCommitted` with a mocked `Connection`: resolves when every account is ≥ 100 bytes with `data[99] === 1`, polls every 750 ms, stops when `remainingMs(locals) < 5000` and answers 503 `executor_pending` (an input) or 503 `pool_unavailable` (a reserve); no plaintext amount or key in any log line — FR-022, FR-023, FR-025, SC-004
- [ ] T019 Implement `ADP/executor.js`: `createInputs(values, authorized, config, locals)` under `providerCall('encrypt-executor')` with `responseType: 'arraybuffer'`, no retry; `waitCommitted(connection, inputs, reserves, locals)` using `request-deadline.js` `remainingMs` — FR-022, FR-023

### Step 6 — `instructions.js` (pure builders, PDAs, layout readers)

- [ ] T020 [P] Tests first in `ADT/dagon-instructions.spec.js` with fixture keys: per kind (create_deposit, InitializeAccount, Wrap, ViewBalance, Transfer, Swap both directions, UnwrapBurn, UnwrapDecrypt with read-only `encryptConfig`, UnwrapComplete) the data bytes and account order / signer / writable flags equal research R6; the fresh key is the only extra signer and sits where data-model "Fresh signer" says; create_deposit `feeVault` = payer when the config's `data[100..132]` is the System Program; PDAs equal `findProgramAddressSync` with the GUIDE seeds; readers `readPcAccount` (202 bytes), `readCiphertextStatus` (digest `[2..34]`, status `[99]`, all-zero digest detected), `readReceipt` (203 bytes) on crafted buffers, wrong length rejected — FR-016 to FR-021, SC-004
- [ ] T021 Implement `ADP/instructions.js`: one pure function per R6 row, `pda()` helpers, the three readers, layout offsets as code constants; no I/O — FR-015 to FR-021

### Step 7 — `index.js` validate

- [ ] T022 Tests first in `ADT/dagon-adapter.spec.js` (validate block): every row of data-model "Build request" — each action's required fields → 400 `missing_parameter`; action outside the eight; amounts `0`, negative, non-integer, ≥ 2^64 → 400 `invalid_parameter`; `minAmountOut=0` → 400; `viewer` or `to` = `publicKey` → 400; invalid base58 in `owner`/`viewer`/`to`/`burnedCt`/`requestAcct`; `freshSigners` repeated in the query, empty entry, invalid key, duplicate, wrong count for the action, equal to `publicKey` / `viewer` / `to` / `owner` / `burnedCt` / `requestAcct` → 400 `invalid_fresh_signers`; `freshSigners=` → `[]` for send and unwrapComplete; any key matching `/secret|private|seed|mnemonic|keypair|signed/i` → 400 `invalid_parameter`; unknown extra keys ignored; `validate` makes no I/O — FR-007, FR-008, SC-004
- [ ] T023 Implement `validate(query)` in `ADP/index.js` (sync, BigInt amounts, fresh-signer count read from the same `freshSigners` map the registry entry uses); re-export the pinned ids from `ADP/config.js` — FR-002, FR-007, FR-008

**Checkpoint**: `npm run test:unit -- powerups profiles` green, existing cases unchanged.

## Phase 3: User Story 1 — set up, wrap and reveal (P1, MVP) — step 8, part 1

**Goal**: the backend builds setup, wrap and reveal for a devnet wallet.

**Independent test**: with mocked `Connection` / `executor` / `config`, each action returns instructions whose signers are the caller plus one fresh key; on devnet, quickstart §3 `--flow setup,wrap,reveal` (T042).

- [ ] T024 [US1] Tests first in `ADT/dagon-adapter.spec.js` (build block, mocked `Connection` + `executor` + `config`): setup with no deposit → create_deposit + InitializeAccount; setup with deposit → InitializeAccount only; setup with `owner` = another wallet → that pc-account, paid and signed by the caller, owner not a signer; pc-account exists → 409 `already_initialized`; wrap of 1000 → Wrap with the fresh key as amount ciphertext and no executor call; reveal → ViewBalance with the fresh key as `viewCt` and `viewer` not a signer, no ciphertext value read; wrap / reveal without a pc-account → 409 `setup_required`; unknown `side` → 400 `invalid_parameter`; a fresh key that already exists on chain → 400 `invalid_fresh_signers` before any executor call; `display` carries the request and `outcomeKnownAfterReveal: true`, never an outcome, quote or success word; provider `{ id: 'dagon', displayName: 'Dagon (devnet preview)', attribution: null }` — FR-007, FR-016, FR-017, FR-018, FR-024, SC-004
- [ ] T025 [US1] Implement `build(params, { locals, connection })` in `ADP/index.js`: load config, resolve sides, one `getMultipleAccountsInfo` for chain state + fresh-signer freshness (R8), the 409s of data-model "Chain state", then setup / wrap / reveal instructions; logs carry action, side and outcome code only — FR-016, FR-017, FR-018, FR-024, FR-025, FR-027

## Phase 4: User Story 2 — swap (P1) — step 8, part 2

**Goal**: swap pc-USDC ↔ pc-DOGE against the active pool with three committed executor inputs.

**Independent test**: mocked build returns a Swap instruction naming the fresh key as receipt with three pc-swap inputs; on devnet, T042 swap + reveal.

- [ ] T026 [US2] Tests first in `ADT/dagon-adapter.spec.js`: USDC → DOGE (direction 0) and DOGE → USDC (direction 1) select the right vaults / reserves; three executor inputs (amountIn, minAmountOut, 0) authorized to pc-swap, waited before building; input balance pending or all-zero digest → 409 `balance_settling` with no executor call; either pc-account missing → 409 `setup_required`; pool missing → 503 `pool_unavailable`; reserve still pending at the end of the wait → 503 `pool_unavailable`; inputs still pending → 503 `executor_pending`; executor down → 503 `executor_unavailable`; same side in and out or a side not in the pool → 400 `invalid_parameter`; no deposit or init prepended — FR-020, FR-022, FR-029, SC-004
- [ ] T027 [US2] Implement swap in `ADP/index.js` (spec OQ2: both pc-accounts required) — FR-020, FR-022, FR-029

## Phase 5: User Story 3 — send (P2, behind a frontend switch) — step 8, part 3

**Goal**: transfer pc-USDC to another set-up devnet wallet; first-time recipients go through setup with `owner` = recipient (covered in T024).

**Independent test**: mocked build returns a Transfer whose only signer is the sender, with one pc-token input.

- [ ] T028 [US3] Tests first in `ADT/dagon-adapter.spec.js`: send with `freshSigners=` → one executor input authorized to pc-token, waited, Transfer with the sender as the only signer; recipient without pc-account → 409 `recipient_setup_required` (never onboarded inside the transfer); sender without pc-account → 409 `setup_required`; sender balance pending or never committed → 409 `balance_settling` before any executor call; `to` = sender → 400 (from T022) — FR-019, FR-029, SC-004
- [ ] T029 [US3] Implement send in `ADP/index.js` (spec OQ3) — FR-019, FR-029

## Phase 6: User Story 4 — unwrap (P3, built and tested, off in the demo) — step 8, part 4

**Goal**: the three unwrap builds.

**Independent test**: mocked builds for burn, decrypt and complete with their 409s; on devnet, T044.

- [ ] T030 [US4] Tests first in `ADT/dagon-adapter.spec.js`: unwrapBurn → one pc-token input, waited, UnwrapBurn with the fresh key as `burnedCt` and the receipt PDA derived from it; unwrapBurn without pc-account → 409 `setup_required`; unwrapDecrypt → fresh key as request account; receipt missing, not 203 bytes or owner ≠ caller → 409 `receipt_not_found` (decrypt and complete); `decrypt_requested` ≠ 0 → 409 `already_requested`; `burnedCt` pending → 409 `balance_settling`; unwrapComplete with `freshSigners=` → only the caller signs, side taken from the receipt's `pc_mint`; `requestAcct` ≠ receipt `request` → 400 `invalid_parameter` — FR-021, FR-022, FR-030, SC-004
- [ ] T031 [US4] Implement unwrapBurn, unwrapDecrypt and unwrapComplete in `ADP/index.js` — FR-021, FR-030

**Checkpoint (end of step 8)**: `npm run test:unit -- dagon` green.

## Phase 7: Exposure — registry, stages, analytics, availability (steps 9–10)

**Purpose**: make `dagon` reachable on staging / local devnet, iOS only, and nowhere else.

### Step 9 — registry, stage flags, analytics

- [ ] T032 Tests first in `src/services/solana/powerups/__tests__/registry.spec.js`: `dagon` entry shape (tier `core`, `networks: ['solana-devnet']`, `contributor: null`, `programIds` = pinned pc-token, pc-swap, Encrypt, SPL Token, System, `lookupTables: []`, `freshSigners` = `{ setup: 1, wrap: 1, reveal: 1, send: 0, swap: 1, unwrapBurn: 1, unwrapDecrypt: 1, unwrapComplete: 0 }`, `errorCodes: ['invalid_fresh_signers']`); offered on `staging` and `local` only, absent on `prod`, `main`, `develop` — FR-001, FR-002, FR-003
- [ ] T033 [P] Tests first in `src/analytics/__tests__/event-schema.spec.js`: the exact list (`:77`) gains `dagon` — FR-005
- [ ] T034 Add the `dagon` entry to `src/services/solana/powerups/registry.js` (ids from `ADP/config.js`; `legacyTransaction: true` only if T006 decided 2b) — FR-001, FR-002, FR-011
- [ ] T035 [P] Add `dagon: { enabled: true }` to the `powerups` block of `src/network-capabilities/network-capabilities-staging.js` (`:56-63`) and `src/network-capabilities/network-capabilities-local.js` (`:55-67`); `-prod.js`, `-main.js`, `-develop.js` untouched — FR-003
- [ ] T036 [P] Append `'dagon'` to `POWERUPS` in `src/analytics/event-schema.js` (`:52`) — FR-005

### Step 10 — availability row

- [ ] T037 [US5] Tests first in `src/availability/__tests__/availability-table.spec.js` and `src/middlewares/__tests__/powerup-gate.spec.js`: `validateTable(DEFAULT_TABLE)` returns no errors; `decide()` for `dagon` → iOS and Android enabled, extension `enabled: false, reason: 'maintenance'`, embargoed country on iOS and on Android → region; the `swap` row deep-equals its current value; gate: `dagon` on the extension → 404, on Android → passes, embargoed country → 403 `region_restricted` — FR-004, FR-026, SC-005
- [ ] T038 [US5] Add `dagon: { enabled: false, reason: 'maintenance', platforms: { ios: { enabled: true, unavailable: EMBARGOED }, android: { enabled: true, unavailable: EMBARGOED } } }` to `DEFAULT_TABLE.capabilities` in `src/availability/availability-table.js` (`:112-126`), `swap` untouched — FR-004

## Phase 8: User Story 5 — nothing else changes: full gate (step 11)

**Goal**: prove Swap, Memo, Payments, SKR, broken-build and mainnet behave as before.

- [ ] T039 [US5] Run the full gate `npm run format:check && npm run lint:check && npm run test:unit` and paste the tail of the output; all green — FR-026, SC-004
- [ ] T040 [US5] Show `git diff origin/staging --stat -- src/__tests__/signing-boundary.spec.js src/routes/` is empty (no route added, signing boundary untouched) and that the only edited existing assertions are the two exact lists (`event-schema.spec.js:77`, `profiles.spec.js:20`) plus additive cases — FR-006, FR-026, SC-004
- [ ] T041 [US5] Grep `src/services/solana/powerups/adapters/dagon/` for Redis / store writes, key generation (`Keypair.generate`, `fromSecretKey`), `sendTransaction` / `sendRawTransaction`, and logging of keys or amounts; expect none — FR-008, FR-025, FR-027

## Phase 9: Local end to end on devnet (step 12)

- [ ] T042 Write `specs/023-dagon-powerup/probe/drive.mjs` (quickstart §3): generates the fresh keypairs in memory, calls the build route with `X-Salmon-Platform: ios`, checks the returned message (fee payer = caller, signer set = caller ∪ fresh, programs declared), signs, sends, waits for the status byte, and for reveal performs the frontend's read (`encryptRead.ts`); prints build latency per call; never writes or logs a secret — SC-001, SC-003
- [ ] T043 Run the backend locally for the Android emulator (quickstart §3 "Android emulator QA"): `NODE_ENV=local npm run serverless:start:local` (listens on `0.0.0.0:3000`); from the host, `curl -H 'X-Salmon-Platform: android' http://localhost:3000/v1/solana-devnet/powerups/availability` lists `dagon` enabled; the app on the emulator uses `http://10.0.2.2:3000` as API base URL — FR-003, FR-004
- [ ] T044 With the local backend from T043 running, run `drive.mjs --flow setup,wrap,reveal,swap,reveal` with the QA keypair from T001; the second reveal shows USDC down by the swap input and DOGE up — US1, US2, SC-001
- [ ] T045 Run `drive.mjs --flow unwrapBurn,unwrapDecrypt,unwrapComplete` once; SPL rises by the amount — US4, SC-002
- [ ] T046 Refusals once each against local: `setup` twice → 409 `already_initialized`; owner key in `freshSigners` → 400 `invalid_fresh_signers`; `X-Salmon-Platform: extension` → 404; `solana-mainnet` → 404; availability endpoint lists `dagon` enabled for iOS and Android — US5, SC-004, SC-005
- [ ] T047 [OWNER] The owner runs setup → wrap → reveal → swap → reveal by hand in the app on the Android emulator (no Maestro) against the local backend from T043, with a Dagon-funded QA wallet imported on the emulator; the agent watches the backend log for the outcome codes and reports any non-200 — US1, US2, FR-004, SC-001
- [ ] T048 From the T044–T045 timings, tune the input-wait reserve (plan open point 2) in `ADP/executor.js` only if needed, with its test in `ADT/dagon-executor.spec.js` — FR-022, SC-003

**Note**: send end to end waits for Dagon to verify transfer (spec US3); run `drive.mjs --flow send` between two QA wallets only once Dagon confirms.

## Phase 10: Staging (steps 13–14) — each write preceded by a warning to the owner

### Step 13 — staging availability row in SSM

- [ ] T049 [OWNER] Owner logs in to AWS so the agent can run `eval "$(aws configure export-credentials --format env)"`, and checks / sets `/salmon-api/staging/TRITON_RPC_URL_DEVNET` (plan open point 8; empty → staging uses the public devnet RPC, which 429s) — FR-004, SC-003
- [ ] T050 Read the live staging table with `node scripts/availability-table.mjs --stage staging`, save it (without the first `version` line) as `~/staging-table.json`, add the `dagon` row from plan design 5 as JSON, then dry run `node scripts/availability-table.mjs --stage staging --file ~/staging-table.json` — FR-004
- [ ] T051 [OWNER] Show the owner the dry-run diff (only added `dagon` lines, iOS and Android rows on, extension off; `swap` byte-for-byte) and warn that it writes the shared staging SSM parameter; wait for the go — FR-004, FR-026
- [ ] T052 After the go, run `node scripts/availability-table.mjs --stage staging --file ~/staging-table.json --execute` and confirm the read-back holds the row — FR-004, SC-005

### Step 14 — staging deploy and smoke

- [ ] T053 [OWNER] Warn the owner before deploying: the staging stack is shared with partner Swap tests; this branch is based on `origin/staging` (show `git log --oneline HEAD..origin/staging` is empty, or merge `origin/staging` first); wait for the go — FR-026, SC-006
- [ ] T054 After the go, run `npm run serverless:deploy:staging` with the exported credentials; record the execute-api URL it prints — FR-003
- [ ] T055 Smoke: `GET /v1/solana-devnet/powerups/availability` with `ios` / `android` / `extension` → `dagon` enabled / enabled / off (`maintenance`); `GET /v1/solana-mainnet/powerups/availability` → no `dagon` — FR-003, FR-004, SC-005
- [ ] T056 Smoke: a partner-style `GET /v1/solana-mainnet/ft/swap/build` answers as before the deploy (same status and shape) — FR-026, SC-006
- [ ] T057 `drive.mjs --base <staging url>` full flow setup → wrap → reveal → swap → reveal, and 10 timed swap builds: setup / wrap / reveal ≤ 3 s, swap inside 25 s in ≥ 9 of 10 — SC-001, SC-003

## Phase 11: After the demo (step 15)

- [ ] T058 [OWNER] After 2026-11-17, the owner approves the next staging deploy from the `staging` branch (drops the code); then remove the `dagon` SSM row with `scripts/availability-table.mjs` (dry run → warn the owner → `--execute`) — FR-004

## Phase 12: Traceability check

- [ ] T059 Confirm every FR-001…FR-030 and SC-001…SC-006 appears in at least one task above (`grep -o 'FR-0[0-9][0-9]' specs/023-dagon-powerup/tasks.md | sort -u` lists 30 ids) and that the table below still matches

| Requirement | Tasks                                                                  |
| ----------- | ---------------------------------------------------------------------- |
| FR-001      | T032, T034                                                             |
| FR-002      | T023, T032, T034                                                       |
| FR-003      | T032, T035, T043, T054, T055                                           |
| FR-004      | T037, T038, T043, T047, T049–T052, T055, T058                          |
| FR-005      | T033, T036                                                             |
| FR-006      | T040                                                                   |
| FR-007      | T022, T023, T024                                                       |
| FR-008      | T022, T023, T041                                                       |
| FR-009      | T007–T010                                                              |
| FR-010      | T009, T010                                                             |
| FR-011      | T009, T034                                                             |
| FR-012      | T015–T017                                                              |
| FR-013      | T016, T017                                                             |
| FR-014      | T016, T017                                                             |
| FR-015      | T016, T017, T021                                                       |
| FR-016      | T020, T024, T025                                                       |
| FR-017      | T020, T024, T025                                                       |
| FR-018      | T020, T024, T025                                                       |
| FR-019      | T020, T028, T029                                                       |
| FR-020      | T020, T026, T027                                                       |
| FR-021      | T020, T030, T031                                                       |
| FR-022      | T018, T019, T026, T030, T048                                           |
| FR-023      | T013, T014, T018, T019                                                 |
| FR-024      | T024, T025                                                             |
| FR-025      | T009, T017, T018, T025, T041                                           |
| FR-026      | T008, T010, T011, T037, T039, T040, T051, T053, T056                   |
| FR-027      | T013, T014, T017, T025, T041                                           |
| FR-028      | T001–T006, T011, T012                                                  |
| FR-029      | T026–T029                                                              |
| FR-030      | T030, T031                                                             |
| SC-001      | T044, T047, T057                                                       |
| SC-002      | T004, T045                                                             |
| SC-003      | T042, T048, T049, T057                                                 |
| SC-004      | T009, T016, T018, T020, T022, T024, T026, T028, T030, T039, T040, T046 |
| SC-005      | T037, T046, T052, T055                                                 |
| SC-006      | T053, T056                                                             |

No requirement is without a task.

## Dependencies and execution order

- Phase 1 (step 0) blocks everything: its outcome decides step 2b (T011–T012).
- Phase 2 runs steps 1 → 2 → 2b → 3 → 4 → 5 → 6 → 7 in that order. Step 2 depends on step 1 (`signers`). Steps 4–6 touch separate files; `[P]` marks the ones with no dependency on an unfinished task (T015 fixture, T020 instruction tests). `index.js` (step 7) needs steps 4–6.
- Phases 3–6 (step 8) all edit `ADP/index.js` and `ADT/dagon-adapter.spec.js`, so they run one after the other: US1 (it builds the shared `build` skeleton) → US2 → US3 → US4.
- Phase 7 (steps 9–10) needs the adapter; T033 / T035 / T036 touch separate files and can run together after T032.
- Phase 8 (step 11) needs everything in `src/`. Phase 9 (step 12) needs Phase 8 green and T001's wallet; T047 also needs T043 running and a frontend build with the Dagon flows (frontend spec 043) on the emulator. Phase 10 needs Phase 9 and the owner (T049, T051, T053). SSM row (step 13) before deploy (step 14), because an extra row is harmless to the code on staging today.

## Owner actions

| Task       | What the owner does                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| T001       | Provides the Dagon-funded QA keypair file outside the repo (mock USDC / DOGE + devnet SOL)                  |
| T047       | Runs the setup → wrap → reveal → swap → reveal QA by hand on the Android emulator against the local backend |
| T049       | Logs in to AWS for credential export; checks / sets `TRITON_RPC_URL_DEVNET` on staging                      |
| T051       | Reads the SSM dry-run diff and gives the go before `--execute`                                              |
| T053       | Gives the go for the shared staging deploy after the warning                                                |
| T058       | Approves the post-demo staging redeploy and SSM row removal                                                 |
| every step | Commits (one commit per plan step)                                                                          |

## Implementation strategy

MVP = Phases 1–3 plus Phase 7–8 (setup, wrap, reveal reachable and the shared rule proven safe). Then swap (Phase 4) for the demo headline, then send and unwrap so they are built and tested even though the demo hides them, then the local end to end, then staging.
