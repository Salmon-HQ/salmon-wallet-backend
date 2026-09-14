# Feature Specification: Swap v2 — build on 0x, sign and send on the device

**Feature Branch**: `012-swap-v2-build` (spec) → implemented on `feat/swap-0x-signing-boundary`

**Created**: 2026-09-02

**Status**: Implemented 2026-09-10 on branch `feat/swap-0x-signing-boundary` (not merged; owner holds the merge for a few days)

**Input**: User description: "Token swap rebuilt build-only: backend returns an unsigned transaction with the Salmon fee, the client signs and broadcasts, gated by region and wallet screening"

> Depends on spec 010 (signing boundary — the route is a GET-only build
> endpoint, so it passes the allowlist as-is) and, still pending, on
> the Phase A region gate in User Story 3, which wraps this route. The
> frontend side is spec 027 in `salmon-wallet-frontend`.

## Context

The previous swap relayed the user's signed transaction through the
backend to Jupiter Ultra's `/execute` (removed by spec 010). That path
made the backend "handle the transaction with the exchange directly" —
the question Apple's 3.1.5(iii) review asks — and Ultra itself is now
deprecated by Jupiter.

The draft of this spec targeted Jupiter `GET /swap/v2/build`. On
2026-09-10 the owner chose the **0x Solana Swap API** instead
(`POST https://api.0x.org/solana/swap-instructions`, open beta, mainnet
only, free tier ≈ 5 RPS). 0x never returns a serialized or signed
transaction: it answers with the quote numbers, a flat ordered list of
raw instructions and the addresses of the lookup tables they need. The
backend compiles those into an unsigned v0 transaction with the user as
fee payer, returns it, the user reviews and signs on the device, the app
broadcasts to its own RPC, and the backend only ever reads public status.

Salmon's fee is a per-request parameter (`swap_fee_ppm`, 1 bps = 100 ppm)
taken on the `buy` side — from the output token — and paid to
`swap_fee_recipient`, which must be an existing token account (or a
wallet address when the output is native SOL). 0x does not create the fee
account and does not echo a fee amount back, so the backend derives the
recipient from a configured owner, verifies it exists, and estimates the
fee from the net output. Jupiter Price v3 / Tokens v2 stay only to hydrate
token metadata and USD values in the response.

Trade-offs accepted: 0x is in open beta (interfaces may change; the
instruction array is planned to split into `setupInstructions` /
`swapInstructions`), mainnet only (no devnet rehearsal), the backend
picks the blockhash so a client that waits must rebuild, and the client
owns retry and confirmation like it does for a normal send.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A user swaps and Salmon never touches the signed transaction (Priority: P1)

A user requests a build, sees the amount in, the estimated amount out and
the minimum after slippage, the route provider, price impact, slippage,
USD values and **the Salmon fee as its own line**, signs on the device,
and the app sends the transaction to the network itself.

**Why this priority**: This is the Powerup's revenue path and the exact
behaviour the Apple answer and the legal position describe.

**Independent Test**: The build endpoint returns a transaction whose
signature slots are all zero; the fee recipient appears among the
accounts of the returned instructions; the backend has no route that
accepts the signed bytes (spec 010 test); the fee lands on-chain when the
client broadcasts (pending: needs a real 0x key).

**Acceptance Scenarios**:

1. **Given** a mainnet pair and amount, **When** a build is requested,
   **Then** the response carries an unsigned base64 v0 transaction,
   `provider: '0x'`, `input`/`output` legs, `route`, `slippageBps`,
   `expiresAt` and a `salmonFee` line.
2. **Given** the returned transaction, **When** decoded, **Then** it has
   no signature, its fee payer is the caller's `publicKey`, and the
   configured fee recipient is referenced by at least one instruction.
3. **Given** the transaction is signed on the device and broadcast,
   **When** it confirms, **Then** the fee account balance increases by
   approximately the displayed fee (0x rounds up; the displayed amount is
   an estimate from the net output).
4. **Given** 0x answers 400 (no route, unsupported pair, bad amount),
   **When** a build is requested, **Then** 404 `no_route` with the
   provider's reason in `error_description` (kept from the old
   contract — the wallet classifies failures by that text).
5. **Given** the wallet points at `solana-devnet`, **When** a build is
   requested, **Then** 400 `invalid_parameter` ("Swap is available on
   solana-mainnet only") and no provider call.

---

### User Story 2 - The fee cannot be removed by a modified client (Priority: P1)

The fee parameters are decided by the backend from configuration; the
client sends only pair, amount (raw or human-readable), slippage and its
public key.

**Acceptance Scenarios**:

1. **Given** a request that includes fee parameters in the query,
   **When** built, **Then** they are ignored and the configured fee is
   applied.
2. **Given** Salmon's fee account for the output mint does not exist
   on-chain, **When** a build is requested, **Then** the fee moves to the
   input token; **and given** neither side has an account, **Then** the
   swap is built fee-less and `[SWAP_FEE_SKIPPED]` is logged as an error
   (owner decision 2026-09-10: an ops gap never blocks the user, and the
   log — not a 503 — is what keeps a fee-less swap from being silent).
3. **Given** 0x returned instructions that never reference the fee
   recipient (e.g. it dropped the fee), **When** the build is assembled,
   **Then** 502 `provider_fee_mismatch` and no transaction is returned.

---

### User Story 3 - The swap respects region and screening (Priority: P1)

The gate has two phases, and only the first is in scope here. The split is
the point: a denylist of embargoed territories needs no legal opinion, while
a positive per-country allowlist cannot be written before counsel names the
countries, and holding the first hostage to the second leaves the route open
to everyone.

**Phase A — embargoed territories (this spec).** `powerupGate('swap')` wraps
`GET /ft/swap/build` and refuses a request whose IP resolves to a
comprehensively embargoed territory: Cuba, Iran, North Korea, Syria, and the
Crimea, Donetsk and Luhansk regions. The list is the one every comparable
wallet publishes in its own terms, and it is what 0x's API Licence Agreement
§8.2(b) obliges Salmon to stand behind — Salmon warrants that no Licensee
User is "prohibited under the OFAC Programs", and since the backend calls 0x,
0x sees Salmon's egress IP and cannot screen a user's location on Salmon's
behalf. Wallet-address screening is 0x's own (CipherOwl, OFAC/EU/UK/UN
lists); the backend's job is to render its refusal, not to duplicate it.

**Phase B — positive allowlist (not in scope).** Enabling swap in a named
country, per Powerup, with an evidence record and an approver per change,
and served from the backend so a stale client cannot keep a territory that
was withdrawn. Phase B is what an App Store submission with a live swap
needs; Phase A is what production needs the day the route opens.

**Acceptance Scenarios**:

1. **Given** an IP that resolves to an embargoed territory, **When** a build
   is requested, **Then** 403 `region_restricted` and no 0x call.
2. **Given** an IP the lookup cannot resolve, **When** a build is requested,
   **Then** the build proceeds. Phase A is a denylist: an unknown country is
   not an embargoed one, and failing closed on every lookup outage would take
   the feature down worldwide.
3. **Given** a listed wallet, **When** a build is requested, **Then** 403
   `wallet_restricted` — 0x answers 403 `TAKER_NOT_AUTHORIZED_FOR_TRADE` and
   the provider adapter already maps it.
4. **Given** the geolocation lookup is unavailable, **When** a build is
   requested, **Then** the failure is logged and the build proceeds, for the
   reason in scenario 2.

**What this gate is not.** It is not evidence of "appropriate licensing and
permissions" for App Review, and it is not the KYC-corroborated geo-block the
FCA describes as good practice — a wallet with no accounts cannot cross-check
an IP against a verified address. Claiming either overstates it.

---

### User Story 4 - Provider attribution and future providers (Priority: P2)

The response names the provider as data so the app renders the
attribution without provider-specific branches; the client-side enum is
`'jupiter' | '0x' | 'dflow'` (frontend spec 027) and the backend emits
`'0x'`.

**Acceptance Scenarios**:

1. **Given** any build response, **When** read, **Then** it carries
   `provider: '0x'`, `providerDisplayName: '0x'`, `attribution: 'Powered by 0x'`
   and `providerRequestId` (0x `zid`) for support.
2. **Given** a second provider is added later, **When** selected,
   **Then** the client receives the same shape with a different
   `provider` value. (No registry exists today — see Deviations.)

### Edge Cases

- Blockhash expiry: the backend fetches the blockhash and reports
  `expiresAt = now + 60 s`; the client must request a fresh build after
  that. Builds are never cached.
- Token-2022 mints with a non-zero transfer fee, an active transfer hook
  or the non-transferable extension are not routed by 0x → 404
  `no_route` with 0x's reason; do not "correct" amounts.
- Native SOL: the fee recipient is the owner wallet itself (no ATA); any
  token pays the owner's associated token account under the mint's own
  program (SPL Token or Token-2022).
- Fee amount display: 0x's `amount_out` is already net of the buy-side
  fee and 0x rounds the fee up, so the shown fee is
  `ceil(net × ppm / (1e6 − ppm))`; the exact on-chain amount may differ
  by rounding.
- `amount` is validated as a positive integer in base units; `uiAmount`
  is converted with the catalog decimals (SOL short-circuits) and answers
  400 `unknown_mint` when the input mint is not in the catalog.
- Rate limits: the 0x free tier is ≈ 5 RPS across all endpoints per
  fixed 1 s window; a process-wide `zeroex-rate-limiter` (default 5,
  `ZEROEX_MAX_RPS`) fronts the calls with retry on 429/5xx.
- Priority fee: when `SWAP_PRIORITY_FEE_MICROLAMPORTS` > 0 the backend
  prepends a `ComputeBudgetProgram.setComputeUnitPrice` instruction and
  asks 0x to reserve 52 bytes (`reserve_transaction_bytes`) so the v0
  transaction stays under 1232 bytes.
- USD values / price impact come from Jupiter Price v3 and are `null`
  when a price is unknown; the transaction is still returned.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `GET /v1/solana-{env}/ft/swap/build` MUST call 0x
  `POST /swap-instructions` with server-configured `swap_fee_ppm`,
  `swap_fee_recipient` and `swap_fee_side: 'buy'`, compile the returned
  instructions into an unsigned v0 `VersionedTransaction` (lookup tables
  and blockhash from the network RPC, caller as fee payer), and return
  the `SwapBuild` shape of `docs/openapi.yaml`:
  `{ provider, providerDisplayName, attribution, providerRequestId, transaction (base64, unsigned), expiresAt, input { mint, amount, decimals, symbol, name, logo }, output { …, minAmount }, route [{ label, percent }], priceImpactPct (nullable), slippageBps, inUsdValue, outUsdValue, salmonFee { amount, mint, bps, decimals, symbol } | null, routeFee (always null for 0x) }`.
- **FR-002**: The client MUST NOT be able to influence fee parameters;
  only `inputMint`, `outputMint`, `publicKey`, `amount` / `uiAmount` and
  `slippageBps` are read from the query.
- **FR-003**: The route MUST be a GET (spec 010 allowlist) and MUST
  answer 400 on a network other than `solana-mainnet` before any
  provider call. The route MUST mount
  `powerupGate('swap', { addressParam: 'publicKey' })`, which refuses an
  embargoed territory with 403 `region_restricted` before any provider call
  (User Story 3, Phase A).
- **FR-004**: A 0x 400 MUST map to 404 `no_route` with the provider's
  reason in `error_description`; any other upstream status (401/429/5xx)
  MUST propagate to `error-handler.js` (500) — it is our credentials or
  the provider being down.
- **FR-005**: The fee account MUST be verified on-chain before the
  provider call: output token first (`salmonFee.side = 'output'`), else
  input token (`'input'`), else no fee plus a `[SWAP_FEE_SKIPPED]` error
  log; a build whose instructions never reference the chosen recipient
  MUST answer 502 `provider_fee_mismatch`.
- **FR-006**: The backend MUST NOT expose any endpoint that accepts the
  signed transaction or broadcasts it; confirmation is read-only via
  existing RPC/history paths.
- **FR-007**: The 0x wire format (snake_case body, byte-array
  instructions, ppm fees) MUST stay inside `zeroex-swap-provider.js`;
  the build service works on web3.js instructions. (No provider
  interface/registry — see Deviations.)
- **FR-008**: Fee and provider configuration (`ZEROEX_API_URL`,
  `ZEROEX_API_KEY`, `ZEROEX_MAX_RPS`, `SWAP_FEE_BPS`,
  `SWAP_FEE_ACCOUNT_OWNER`, `SWAP_PRIORITY_FEE_MICROLAMPORTS`) MUST live
  in SSM/env like other secrets; the fee account owner's private key MUST
  never be in the repo, the app or any system Salmon runs. `SWAP_FEE_BPS`
  and `SWAP_FEE_ACCOUNT_OWNER` both unset = no fee.
- **FR-009**: `docs/openapi.yaml` (`SwapBuild`), `AGENTS.md` (contract
  `solana-swap-build`), the `solana-rpc-context` skill, `.env.example`
  and `CHANGELOG.md` MUST be updated; the capability section `swap`
  stays the client-side switch.
- **FR-010**: Full CI gate; unit tests with recorded 0x fixtures at the
  provider, service, resource and controller layers. One nightly
  `*.integration.spec.js` against 0x asserting the fee instruction is
  present and the transaction is unsigned — pending, needs a real key.

### Key Entities

- **Build response**: see FR-001 / `SwapBuild` in `docs/openapi.yaml`.
- **Provider adapter**: `zeroex-swap-provider.js` (0x wire format in,
  web3.js instructions out).
- **Fee config**: bps + fee account owner; the recipient is derived per
  output mint (owner ATA, or the wallet for native SOL) and must
  pre-exist.

## Success Criteria _(mandatory)_

- **SC-001**: 100% of build responses decode to an unsigned transaction
  whose instructions reference the configured fee recipient (unit-tested
  with recorded fixtures; on-chain check pending a real key).
- **SC-002**: The signing-boundary test (spec 010) passes with the new
  route present.
- **SC-003**: A request for a non-mainnet network, an invalid address,
  identical mints, a bad amount/slippage or a missing fee account never
  reaches 0x (asserted with a mocked provider).
- **SC-004**: Salmon's realized fee per swap is within rounding of the
  displayed `salmonFee.amount` (nightly integration test, pending).
- **SC-005**: Frontend spec 027's swap module works against the new
  shape with no provider-specific branches.

## Assumptions

- The 0x free tier is enough for the initial volume; a higher plan is a
  dashboard change plus `ZEROEX_MAX_RPS`.
- Fee token accounts for the mints users swap into most (SOL wallet,
  USDC, USDT at least) are created by ops before the fee is enabled; a
  missing one turns that pair into a 503, never a fee-less swap.
- Legal opinion per enabled territory exists before Swap is enabled in
  a named country (owner/counsel, outside the repo). That opinion gates
  Phase B, not Phase A: refusing an embargoed territory needs no opinion.
  The production switch remains the `ZEROEX_API_KEY` SSM parameter.

## Open decisions (owner)

- ~~Fee bps value (`SWAP_FEE_BPS`).~~ **Decided (owner, 2026-09-14): 50
  bps.** The value is served from SSM and named on the confirmation
  screen; it is never compiled into a client.
- Fee account owner pubkey (`SWAP_FEE_ACCOUNT_OWNER`) and creating its
  fee ATAs (SOL/USDC/USDT at least).
- Which countries are enabled (Phase B). Phase A needs no answer: the
  embargoed list is not a product decision.
- 0x dashboard plan / RPS (`ZEROEX_MAX_RPS`).
- UNVERIFIED from the research, needs a real-key probe: native SOL
  address `So111…111` (schema text) vs `So111…112` (WSOL mint, every
  code example) — which is accepted and what each does to the taker's
  SOL/WSOL balance; the code sends the repo's `SOL_ADDRESS` constant.
- UNVERIFIED, same probe: whether the structured
  `{ associatedTokenAccount: { owner } }` form of `swap_fee_recipient`
  auto-creates the fee ATA (per the OpenAPI schema) or a plain address is
  required to pre-exist (per the integration notes). The code passes a
  plain address and requires it to exist.
- Whether 0x takes a cut of `swap_fee_*` and its trade-surplus policy
  (`trade_surplus_cap_ppm` — "when 0x controls trade surplus collection,
  the request value is ignored").

## Deviations from the written spec

Recorded 2026-09-10 against the implemented branch.

- **Provider is 0x, not Jupiter `/swap/v2/build`** (owner decision
  2026-09-10). Jupiter Price v3 / Tokens v2 remain only for token
  metadata and USD values in the resource.
- **No `SwapProvider` interface, registry or per-country provider
  selection** (YAGNI, one provider). If a second provider arrives, the
  seam is `zeroex.requestSwapInstructions(...)` in
  `solana-swap-build-service.js`: a sibling adapter returning the same
  `{ instructions, lookupTableAddresses, amountOut, minAmountOut, routePlan, zid }`
  and a selector in front of that call.
- **Region gating is Phase A only** — the gate refuses embargoed
  territories; the positive per-country allowlist is Phase B and is not
  built. Until Phase B lands, the route serves every country that is not
  embargoed, once `ZEROEX_API_KEY` is set.
- **No nightly integration spec yet** — needs a real 0x key; pending.
- **Response shape**: `salmonFee` carries `decimals` + `symbol` (asked by
  the frontend), `routeFee` is always `null` for 0x, `providerRequestId`
  carries the 0x `zid`, `priceImpactPct` is derived from USD values and
  may be `null`, `inUsdValue` / `outUsdValue` were added.
- **Fee side**: taken from the output token (`buy`), recipient = owner
  ATA for the output mint (wallet for native SOL); there is no
  provider-chosen fee mint.
- **Fee amount is estimated**, not read from the provider (0x returns no
  fee amount).
- `resolveAmount` / `resolveSlippage` validation lives in the build
  service, called from the controller.
- Config: `JUPITER_SWAP_*` removed; `ZEROEX_API_URL`, `ZEROEX_API_KEY`,
  `ZEROEX_MAX_RPS`, `SWAP_FEE_BPS`, `SWAP_FEE_ACCOUNT_OWNER`,
  `SWAP_PRIORITY_FEE_MICROLAMPORTS` added.

## Out of scope

- Client-side signing/broadcast/confirmation — frontend spec 027.
- The positive per-country allowlist — User Story 3, Phase B. Wallet
  screening stays 0x's (CipherOwl); the backend renders its 403.
- Jupiter / DFlow adapters — separate features once their terms/pricing
  are confirmed.
- Sponsored (gasless) swaps, `trade_surplus_*`, `disabled_sources`,
  exact-out swaps.
