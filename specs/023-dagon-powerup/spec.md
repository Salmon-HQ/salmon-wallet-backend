# Feature Specification: Dagon Powerup (devnet preview)

**Feature Branch**: `feat/dev-93-dagon-powerup` (spec dir `023-dagon-powerup`; frontend spec `salmon-wallet-frontend/specs/043-dagon-powerup`). Linear DEV-93.

**Created**: 2026-10-30

**Status**: Draft

**Input**: Owner decisions (2026-10-30): a devnet-only "Dagon" Powerup for a demo build shown at Solana Breakpoint (2026-11-15 to 2026-11-17). It lives on a branch that is never merged; the demo app uses the EAS `staging` profile, so this branch is deployed to the staging stack, which also serves partner Swap tests and must keep behaving exactly as before. Not for the store app. Flows: setup, wrap, reveal, send, swap, unwrap (three steps). Unwrap is built and tested but off in the demo; send stays behind a switch until Dagon verifies transfer.

## Context

Dagon (Inkwell Finance) publishes two Solana programs, pc-token and pc-swap, built on Encrypt (dWallet Labs), a network meant to do arithmetic on encrypted numbers (FHE). A pc-token balance is stored as a "ciphertext account" instead of a number. Encrypt is pre-alpha: nothing is actually encrypted yet, every value is readable on chain, and the devnet deployment will be wiped when Encrypt's next phase lands. The mock tokens (USDC, DOGE) are worth nothing and use 2 decimals.

Primary sources: Dagon's integration kit (`inkwell-finance/pc-wallet-kit`: `GUIDE.md` §1–§9, `devnet.json` epoch 2, `reference/pcSwap.ts`, `reference/encryptRead.ts`) and the frontend research spec 043 (flows, spike, signing design).

Facts the backend must design around:

- **Fresh co-signers.** pc-token and pc-swap refuse any new ciphertext, receipt or request account that is not a brand-new, empty keypair signing the transaction (`require_fresh`). The wallet's core generates those keypairs on the device and sends only their public keys.
- **Executor inputs.** Send, swap and unwrap need input ciphertexts created by the Encrypt executor (`createInput`, a unary gRPC-web call) and committed (status byte `data[99] == 1`) before the transaction is sent; a transaction sent while they are pending computes zero. Dagon observes 1–10 s for that commit.
- **Silent failures.** An insufficient balance, a swap below its floor or an unwrap larger than the balance succeeds on chain and moves nothing. A successful simulation proves nothing about the outcome.
- **Executor drops.** The devnet executor never processes about 10% of confirmed transactions; their ciphertexts stay pending forever. A dropped pool write stalls the pool until Dagon publishes a replacement under a new `devnet.json` epoch.
- **Overwritable ciphertexts.** Anyone can overwrite any ciphertext on devnet through the Encrypt program directly. Balances on devnet are not trustworthy.
- **Not reproducible.** `devnet.json` records `reproducible: false`: the deployed program bytes cannot be rebuilt from source and checked.
- **Swap floor not enforced.** `devnet.json` lists it as a known issue: a swap can fill below its minimum.
- **Unwrap has no refund path.** If the executor never answers the decryption request, the burned amount stays stuck.

Existing backend machinery this builds on: the generic Powerup build (`/powerups/:id/build`, registry → adapter → one compile step → declared-program check → single-signer check → simulation), the stage `powerups` block, the availability table in SSM (per capability × platform × country), the `powerupGate` seam, `providerCall` with per-provider profiles, the analytics event schema (`POWERUPS` enum), and the signing-boundary test.

## Cross-repo contract (fixed; the frontend spec uses the same one)

1. **Route**: the existing `GET /powerups/:id/build` with id `dagon`, network `solana-devnet`, query `publicKey`, `action`, the action's parameters and `freshSigners` (a comma-separated list of base58 public keys; empty when the action needs none), `action` ∈ `setup | wrap | reveal | send | swap | unwrapBurn | unwrapDecrypt | unwrapComplete`. The response is the existing Powerup build resource (unsigned transaction, expiry, display).
2. **Fresh co-signers**: generated on the device; only their public keys travel in `freshSigners`. The backend never generates, receives or holds a fresh private key. It places those public keys as the required signer accounts and returns an unsigned v0 transaction (legacy for `dagon` only if FR-028 shows the programs refuse v0).
3. **Signer check**: the single-signer rule is relaxed only for a registry entry that declares fresh signers for that action and only on `solana-devnet`: required signatures = 1 + `freshSigners.length`, and the signer set is exactly {owner} ∪ `freshSigners`. Every other Powerup and every mainnet build keeps the single-signer rule.
4. **Program pinning**: pc-token `3kjJEx6G1XdrtixFg9f8eGRAyzW5QmhsJQq6qCUZYhXZ` and pc-swap `BqJMtWQYiis1264KqBN3wssNqTofK5RuP67hkZYvb4SD` (epoch 2) are pinned in the registry. `devnet.json` is read at runtime from `https://raw.githubusercontent.com/inkwell-finance/pc-wallet-kit/main/devnet.json`, cached, and refused when its program ids differ from the pinned ones. Encrypt program, executor URL, pool and mints come from `devnet.json`.
5. **Executor inputs**: `createInput` (send, swap, unwrap) is called by the backend adapter against the Encrypt executor (`https://pre-alpha-dev-1.encrypt.ika-network.net`). The reveal read (`readCiphertext`, signed by an ephemeral viewer key) is done by the frontend, never the backend.
6. **Settlement**: watching for settlement is the frontend's job; the backend only builds.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Set up, wrap and reveal (Priority: P1)

On devnet, a demo wallet on iOS sets up its pc-USDC account, wraps mock USDC into pc-USDC, and asks for a reveal transaction so the device can read its balance. The backend returns, for each step, an unsigned transaction the wallet's core can complete with the fresh keys it generated and the user's signature.

**Why this priority**: it is the first thing the demo shows and every other flow needs a set-up, funded pc-account.

**Independent Test**: with a QA wallet funded by Dagon, build setup → sign and send on device → build wrap of 10.00 → sign and send → build reveal → sign and send; the frontend's read shows 10.00 pc-USDC and the SPL balance dropped by 10.00.

**Acceptance Scenarios**:

1. **Given** a wallet with no Encrypt deposit and no pc-USDC account, **When** it requests `setup` for USDC with one fresh signer, **Then** the response is an unsigned transaction that creates the deposit and the pc-account, whose required signers are exactly the wallet and that fresh key, and every top-level program is declared.
2. **Given** a wallet whose deposit exists but whose pc-USDC account does not, **When** it requests `setup`, **Then** the transaction creates only the pc-account.
3. **Given** a wallet whose pc-USDC account already exists, **When** it requests `setup` for USDC, **Then** 409 `already_initialized` and nothing is built.
4. **Given** a set-up wallet with mock USDC, **When** it requests `wrap` of 1000 base units (10.00) with one fresh signer, **Then** the transaction moves 10.00 USDC from the wallet's token account into the vault and names the fresh key as the amount ciphertext.
5. **Given** a set-up wallet, **When** it requests `reveal` with one fresh signer and a `viewer` public key, **Then** the transaction copies the balance ciphertext to the fresh account authorized to `viewer`, and `viewer` is not a signer.
6. **Given** a wallet with no pc-account for the mint, **When** it requests `wrap` or `reveal`, **Then** 409 `setup_required`.

### User Story 2 - Swap (Priority: P1)

The wallet swaps pc-USDC for pc-DOGE against the epoch 2 pool with an input amount and a minimum output. The backend creates the three executor inputs, waits for them to commit, and returns the swap transaction.

**Why this priority**: the swap against an encrypted pool is the demo's headline.

**Independent Test**: a 1.00 pc-USDC → pc-DOGE build on devnet returns a transaction that, signed and sent, settles; a frontend reveal of pc-DOGE shows the increase.

**Acceptance Scenarios**:

1. **Given** a wallet with set-up pc-USDC and pc-DOGE accounts and a committed pc-USDC balance, **When** it requests `swap` from USDC to DOGE with `amountIn` 100, `minAmountOut` 90 and one fresh signer, **Then** the backend creates three executor inputs (amount in, minimum out, a zero output placeholder) authorized to pc-swap, waits until all three are committed, and returns a transaction naming the fresh key as the swap receipt.
2. **Given** the wallet's input balance ciphertext was never committed (all-zero digest), **When** it requests `swap`, **Then** 409 `balance_settling` and no executor input is created.
3. **Given** the wallet has no pc-account for the output mint, **When** it requests `swap`, **Then** 409 `setup_required`.
4. **Given** the executor inputs are not committed within the build's time budget, **When** the build waits, **Then** 503 `executor_pending` (the caller may retry; nothing was signed).
5. **Given** the executor is unreachable, **When** a swap is requested, **Then** 503 `executor_unavailable`.

### User Story 3 - Send (Priority: P2, behind a frontend switch)

The wallet sends pc-USDC to another devnet address. A first-time recipient is onboarded first by a `setup` built for the recipient's address and paid by the sender.

**Why this priority**: Dagon has not verified transfer end to end; it ships behind a switch.

**Independent Test**: once Dagon verifies transfer, a 1.00 send between two QA wallets is revealed on both sides.

**Acceptance Scenarios**:

1. **Given** both wallets have pc-USDC accounts, **When** the sender requests `send` of 100 to the recipient with an empty `freshSigners`, **Then** the backend creates one executor input authorized to pc-token, waits for it to commit, and returns a transfer transaction whose only signer is the sender.
2. **Given** the recipient has no pc-USDC account, **When** the sender requests `send`, **Then** 409 `recipient_setup_required`.
3. **Given** the recipient has no pc-USDC account, **When** the sender requests `setup` with `owner` = recipient and one fresh signer, **Then** the transaction creates the recipient's pc-account, paid and signed by the sender.
4. **Given** the recipient equals the sender, **When** `send` is requested, **Then** 400 `invalid_parameter`.

### User Story 4 - Unwrap (Priority: P3, built and tested, off in the demo)

The wallet burns pc-USDC into a receipt, requests decryption of the burned amount, and once the executor posts it, completes the unwrap to get mock USDC back. Three builds, one per step.

**Why this priority**: Dagon advises against demoing it (no refund if the executor never answers); it must still work and be tested.

**Independent Test**: on devnet, `unwrapBurn` 1.00 → send → `unwrapDecrypt` → send → wait → `unwrapComplete` → send; the SPL balance rises by 1.00.

**Acceptance Scenarios**:

1. **Given** a set-up wallet, **When** it requests `unwrapBurn` of 100 with one fresh signer, **Then** the backend creates one executor input, waits for it to commit, and returns a transaction naming the fresh key as the burned-amount ciphertext and creating the receipt derived from it.
2. **Given** a burn receipt exists for `burnedCt`, **When** the wallet requests `unwrapDecrypt` with `burnedCt` and one fresh signer, **Then** the transaction names the fresh key as the decryption request account.
3. **Given** the receipt's decryption was already requested, **When** `unwrapDecrypt` is requested again, **Then** 409 `already_requested`.
4. **Given** a receipt and its request account, **When** the wallet requests `unwrapComplete` with `burnedCt` and `requestAcct` and an empty `freshSigners`, **Then** the transaction releases SPL to the wallet and its only signer is the wallet.
5. **Given** the receipt does not exist or does not belong to the wallet, **When** `unwrapDecrypt` or `unwrapComplete` is requested, **Then** 409 `receipt_not_found`.

### User Story 5 - Nothing else changes (Priority: P1)

Partners keep testing Swap on the staging stack while this branch is deployed there, and every other Powerup and every mainnet build behaves exactly as before.

**Why this priority**: the staging stack is shared; a regression here breaks partner tests that have nothing to do with the demo.

**Independent Test**: the existing Powerup, availability, signing-boundary and swap test suites pass unchanged; new tests prove a multi-signer message is still refused for every Powerup other than `dagon` and on mainnet.

**Acceptance Scenarios**:

1. **Given** any Powerup other than `dagon` (memo, broken-build, and any future one), **When** its compiled message needs more than one signature, **Then** 502 `provider_signer_mismatch`, as today.
2. **Given** `dagon` on any network other than `solana-devnet`, **When** a build is requested, **Then** 404 `not_found`.
3. **Given** a `dagon` build whose compiled signer set differs from {owner} ∪ `freshSigners` in any way (a missing key, an extra key, the owner absent), **Then** 502 `provider_signer_mismatch`.
4. **Given** `GET /powerups/:id/build`, **When** called as today for any Powerup other than `dagon`, **Then** the same response as before this feature; no route is added.

### Edge Cases

- **`devnet.json` unreachable**: the last good cached copy is served while it exists; with none, 503 `dagon_config_unavailable` and nothing is built.
- **`devnet.json` malformed, cluster not `devnet`, or pc-token / pc-swap ids differ from the pinned ones**: refused, logged, 503 `dagon_config_unavailable`; a cached good copy is not replaced by a refused one.
- **New `devnet.json` epoch with the same pinned programs** (a replacement pool): accepted; the new pool, mints and reserves take effect when the cache refreshes, without a deploy.
- **Pool stalled** (a reserve ciphertext pending past the build's time budget, or the pool missing): swap answers 503 `pool_unavailable`.
- **Executor answers `createInput` with zero or several ids**: 502 `executor_bad_response`; never build with a guessed id.
- **Fresh signer problems**: wrong count for the action, a duplicate, a key equal to the owner, the `viewer` key, or the recipient, an invalid base58 key, or an address that already has an on-chain account → 400 `invalid_fresh_signers` before any executor call.
- **Amounts**: zero, negative, non-integer, or above the 64-bit range → 400 `invalid_parameter`. Amounts are base units (2 decimals for the mock tokens).
- **Unknown side** (a mint name not in `devnet.json`'s `sides`) or swap with the same side in and out → 400 `invalid_parameter`.
- **Wrap larger than the SPL balance**: the public SPL transfer fails in simulation → 422 `simulation_failed` (this one failure is loud, unlike the confidential ones).
- **Silent failure cases** (insufficient pc-token balance on send, swap or unwrap; missed floor): the build succeeds; the backend never claims an outcome.
- **Executor drops the user's transaction after it confirms**: invisible to the backend; the frontend's settlement watcher reports "unknown".
- **Missing `X-Salmon-Platform`** resolves to `ios` (the existing rule), so a caller without the header can build on staging devnet; acceptable because the tokens are worthless and the stage is not public.
- **Abandoned inputs**: an executor input created for a build the user never sends stays on devnet unused; harmless, no cleanup.
- **Recipient or owner given for `setup`** is a different wallet: allowed (the sender pays to onboard a recipient); the owner is a read-only account and does not sign.

## Requirements _(mandatory)_

### Functional Requirements

Registry, stage and availability

- **FR-001**: The registry MUST carry a `dagon` entry, tier `core`, declared for `solana-devnet` only, with `programIds` = pinned pc-token, pinned pc-swap, Encrypt, SPL Token and System (plus the always-allowed Compute Budget), no lookup tables, and its adapter.
- **FR-002**: The `dagon` entry MUST declare, per action, how many fresh signers it requires: setup 1, wrap 1, reveal 1, send 0, swap 1, unwrapBurn 1, unwrapDecrypt 1, unwrapComplete 0. The declaration is code in the registry, never caller-supplied.
- **FR-003**: The stage `powerups` block MUST enable `dagon` on `staging` (and `local` for development) and MUST NOT enable it on `prod`, `main` or `develop`.
- **FR-004**: The availability table MUST offer `dagon` on iOS only: off on Android and the extension, with every embargoed country unavailable on the iOS row. The row MUST be present in both the built-in default table and the staging SSM parameter before the demo, written through the existing validating script; the existing `swap` row MUST stay byte-for-byte unchanged.
- **FR-005**: The analytics schema MUST accept `dagon` as a `powerup` value; no other analytics change.

Route and validation

- **FR-006**: `dagon` MUST be built through the existing `GET /powerups/:id/build` with query parameters (`publicKey`, `action`, the action's parameters, and `freshSigners` as a comma-separated list of base58 public keys). No route is added, so the signing-boundary allowlist and the GET-only rule in `AGENTS.md` stay as they are.
- **FR-007**: Every caller input MUST be validated before any executor or upstream call: action in the allowed set; `freshSigners` parsed from its comma-separated form with no empty entries; `publicKey`, `freshSigners`, `viewer`, `to`, `owner`, `burnedCt`, `requestAcct` valid Solana addresses; amounts positive integers within 64 bits; sides known in the active `devnet.json`; fresh signers distinct, of the declared count, distinct from every other key in the request, and with no existing on-chain account.
- **FR-008**: The backend MUST NOT accept, generate, log or store a private key, a seed, or a signed transaction, and MUST NOT broadcast. Requests carrying a field named like a secret key are refused with 400.

Signer check

- **FR-009**: The build service MUST relax the single-signer rule only when all three hold: the entry declares fresh signers for the requested action, the network is `solana-devnet`, and the compiled message's signer set equals {owner} ∪ `freshSigners` exactly, with the owner as fee payer and required signatures = 1 + `freshSigners.length`. Anything else MUST answer 502 `provider_signer_mismatch` and return no bytes.
- **FR-010**: Every other Powerup and every build on any other network MUST keep the single-signer rule unchanged, proven by tests that feed a two-signer message to a non-`dagon` entry and a `dagon`-shaped entry on mainnet and expect 502.
- **FR-011**: The declared-program check, the declared-lookup-table check and the simulation step MUST apply to `dagon` builds exactly as to every other Powerup.

Configuration

- **FR-012**: The adapter MUST read `devnet.json` from the pinned URL through `providerCall`, cache it in container memory (recommended 5 minutes), keep the last good copy on a fetch failure, and refuse any copy that is malformed, not `cluster: devnet`, or whose pc-token or pc-swap id differs from the pinned ids.
- **FR-013**: The Encrypt program id in `devnet.json` MUST equal the Encrypt id declared in the registry, or the copy is refused (see Open question 2).
- **FR-014**: The executor URL from `devnet.json` MUST be HTTPS and on the Encrypt executor's host allowlist (recommended: exactly `pre-alpha-dev-1.encrypt.ika-network.net`), or the copy is refused, so a changed remote file cannot point the backend at an arbitrary server.
- **FR-015**: Pool, mints, vaults, reserves, the network key and the FHE type MUST come from the accepted `devnet.json`; none is a code constant except the pinned program ids.

Building each action

- **FR-016**: `setup` MUST build the Encrypt deposit (only when the payer has none) and the pc-account for the given side and owner (default owner = caller), with the fresh key as the balance ciphertext; 409 `already_initialized` when the pc-account exists.
- **FR-017**: `wrap` MUST build the SPL-to-vault wrap for the given side and amount with the fresh key as the amount ciphertext and MUST NOT call the executor.
- **FR-018**: `reveal` MUST build the balance copy authorized to the caller's `viewer` key with the fresh key as the copy account; the backend MUST NOT read or decrypt any ciphertext value.
- **FR-019**: `send` MUST create one executor input authorized to pc-token, wait for it to commit, and build the transfer; 409 `recipient_setup_required` when the recipient has no pc-account.
- **FR-020**: `swap` MUST refuse an all-zero input balance digest (409 `balance_settling`), create three executor inputs authorized to pc-swap (amount in, minimum out, zero), wait for all three to commit, and build the swap with the fresh key as the receipt; direction derived from the two sides against the pool's A/B sides.
- **FR-021**: `unwrapBurn`, `unwrapDecrypt` and `unwrapComplete` MUST build the three unwrap steps as Dagon's guide defines them, deriving the receipt from `burnedCt`, checking that it belongs to the caller's pc-account, and answering 409 `receipt_not_found` / `already_requested` where the chain state says so.
- **FR-022**: Waiting for executor inputs MUST stay inside the request's existing 25 s budget; when inputs are still pending, 503 `executor_pending`. Executor transport failures MUST be 503 `executor_unavailable` through the circuit breaker; a malformed executor answer MUST be 502 `executor_bad_response`.
- **FR-023**: Executor and `devnet.json` calls MUST each run under their own provider profile; no existing profile changes.

Truthfulness and isolation

- **FR-024**: The build response MUST NOT claim an outcome: `display` carries what was requested (action, side(s), amounts as requested, recipient) and a fixed flag that the outcome is known only after a reveal; never "success", a quote, or an expected output.
- **FR-025**: Logs MUST carry action, side and outcome code only; never fresh-signer keys alongside the wallet, amounts, or the recipient.
- **FR-026**: Swap, Memo, Payments, SKR, broken-build and every mainnet build MUST behave exactly as before this feature: same responses, same status codes, same signer rule, same availability decisions. The existing test suites pass unchanged.
- **FR-027**: The feature MUST NOT add persistent storage or write to the shared data store beyond the circuit-breaker and rate-limiter keys of its two new provider profiles.
- **FR-028**: The first implementation task MUST prove on devnet, by simulating one build per Dagon instruction kind, that pc-token and pc-swap accept a v0 transaction (Dagon's reference client builds legacy ones). If they do not, the shared builder emits a legacy transaction for `dagon` builds only, and every other Powerup keeps v0.

### Key Entities

- **Dagon configuration** (`devnet.json`): epoch, cluster, program ids, executor URL, network key, sides (USDC, DOGE: SPL mint, pc-mint, vault, decimals), pool (address, vault accounts, reserve ciphertexts). Accepted only when it matches the pinned programs.
- **Build request**: caller (`publicKey`), `action`, action parameters (side(s), amount(s), `minAmountOut`, `to`, `owner`, `viewer`, `burnedCt`, `requestAcct`), `freshSigners`.
- **Fresh signer**: a public key the device generated for one transaction; the backend only names it as a signer account.
- **Executor input**: a ciphertext account the executor creates for a plaintext amount on the backend's request, authorized to pc-token or pc-swap; usable once committed.
- **Unwrap receipt**: on-chain record derived from `burnedCt` that binds the three unwrap steps.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On staging devnet, a QA wallet on the iPhone completes setup → wrap → reveal → swap → reveal with every build answered by the backend and no signer or program refusal.
- **SC-002**: Unwrap's three steps complete once end to end on devnet before the demo build is frozen, even though the demo hides it.
- **SC-003**: Wrap, reveal and setup builds answer within 3 s; send, swap and unwrapBurn builds answer within the 25 s request budget in at least 9 of 10 attempts on devnet.
- **SC-004**: 100% of the existing Powerup, availability, signing-boundary, swap and analytics tests pass unchanged; new tests cover: a two-signer message refused for a non-`dagon` entry, refused for `dagon` on mainnet, refused when a fresh key is missing, extra or swapped; `devnet.json` with a changed program id refused; fresh-signer validation; each action's 409s.
- **SC-005**: The availability endpoint on staging lists `dagon` enabled for iOS on devnet and disabled for Android and the extension; it is absent on mainnet and on prod.
- **SC-006**: A partner Swap request on staging during the demo period gets the same answer as before the branch was deployed.

## Assumptions

- The branch is deployed to staging only and never merged; the next staging deploy from the `staging` branch removes it, so the staging SSM row for `dagon` is removed then too (an unknown capability row is harmless to the validator).
- The device's core verifies the returned message (fresh signers exactly its keys, programs in its manifest, fee payer the user) before signing; the backend's checks are the server half of that guarantee.
- Whether pc-token and pc-swap accept v0 transactions is settled by FR-028 before any flow is built.
- The compute-unit limit comes from simulation, as for every Powerup; Dagon's fixed limits (up to 1,000,000 for swap) stay below the 1,400,000 ceiling.
- Plaintext amounts reach the executor whoever calls it; the frontend's disclosure covers it (frontend spec 043, decision 7).
- Test tokens come from Dagon on request; there is no faucet action.
- The staging stack reaches devnet through the existing `solana-devnet` network config.

## Open questions (recommended defaults)

1. **Encrypt program id.** The contract says it comes from `devnet.json`, but the declared-program check needs it in the registry. Default: declare the current Encrypt id (`4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`) in the registry and refuse a `devnet.json` that names another (FR-013); an Encrypt redeploy then needs a code change, which is right for a program the backend cannot verify.
2. **Swap to an output mint without a pc-account.** Dagon's reference adds the output account inside the swap (two fresh signers). Default: require `setup` for both sides first (409 `setup_required`), so each action has a fixed fresh-signer count.
3. **First-time send recipient.** `send` answers 409 `recipient_setup_required` and the wallet then requests a separate `setup` with `owner` = recipient, as Dagon's reference does, because the executor drops work when account creation and the first write share a transaction (User Story 3).
4. **Where the send and unwrap switches live.** Default: in the frontend only; the backend builds every action so they stay testable. Alternative: a per-action list in the staging `powerups` block, if the owner wants the backend to refuse them in the demo.
5. **`devnet.json` epoch.** Default: accept any epoch whose pinned programs match, so a replacement pool needs no deploy; refuse only on program mismatch.
6. **Off-platform reason in the availability row.** The table only knows `maintenance` and `deprecated` as off reasons. Default: Android and extension rows off with `maintenance`; a new reason value is not worth a validator change on a never-merged branch.

## Out of scope

- Mainnet, any non-devnet network, prod, the store app, TestFlight builds for the public.
- Reading or decrypting ciphertexts on the backend (reveal read), and settlement watching.
- Generating, holding or signing with any key; relaying or broadcasting transactions.
- A Salmon fee on any Dagon build.
- A faucet or test-token distribution.
- Recovery of an unwrap stuck by the executor.
- Changes to root `AGENTS.md`, `docs/`, or the frontend.
