# Feature Specification: Swap on Jupiter, 0x where Jupiter cannot, offered where it may be offered

**Feature Branch**: `018-swap-jupiter-availability`

**Created**: 2026-09-30

**Status**: Draft — owner decisions of 2026-09-30 recorded below; not implemented

**Input**: User description: "Swap with Jupiter as the default provider and 0x only where Jupiter cannot serve; availability by country, platform and provider; United States off until confirmed"

> Continues `specs/012-swap-v2-build` (0x, implemented on branch
> `feat/powerup-swap`) and amends `specs/011-capability-availability` (the
> gate) in the same branch: what 012 built is reused; what this spec adds is
> the availability table, the platform dimension and the second provider. Depends on spec 010 (signing boundary): the route
> stays a GET-only build endpoint. The client side is frontend spec 027.

## Context

Salmon's swap is build-only: the backend returns an unsigned transaction,
the device signs it and broadcasts it to its own RPC, and the backend never
sees the signed bytes. That model is in production for NFTs and Powerups
(0.19.0) and is what the store answers rest on.

What is settled on 2026-09-30:

1. **Providers.** Salmon holds both plans: Jupiter Developer (10 requests
   per second, no Jupiter fee on the Router path) and 0x Standard (0.15%
   swap fee charged on-chain to the user, 5 requests per second). **Jupiter
   is the default because it costs the user nothing extra; 0x exists only
   for the countries Jupiter refuses to serve.** 0x names no country and
   screens every wallet address itself; its adapter, fee-account
   resolution, fee verification and the `SwapBuild` response shape are
   implemented on `feat/powerup-swap` and are reused. The Jupiter adapter is
   new. The response shape does not change between providers: the provider
   name and attribution arrive as data.
2. **Territory.** The **United States is off** on every platform until the
   owner confirms in writing.

Jupiter's terms shape two requirements of this spec:

- Jupiter "does not interact with digital wallets located in, established
  in, or a resident of" the United States, the Republic of China, Singapore,
  Myanmar, Côte d'Ivoire, Cuba, Crimea and Sevastopol, DR Congo, Iran, Iraq,
  Libya, Mali, Nicaragua, North Korea, Somalia, Sudan, Syria, Yemen,
  Zimbabwe, or any territory under US, UK or EU sanctions (Terms of Use,
  "Prohibited Localities"). A table row may name Jupiter only outside that
  list; those countries are where 0x serves.
- The API licence makes the integrator "perform transaction screening and
  monitoring of all digital wallets interacting with the Client's Product,
  including blocking of sanctioned ... digital wallets" (§7.3) and puts all
  KYC/AML duties on the integrator (§7.4). 0x's screening happens inside
  0x's own request and cannot be borrowed, so every Jupiter request is
  screened by Salmon (User Story 3). With Jupiter as the default, that
  screening ships in the first release.

## Owner decisions (2026-09-30)

1. **Both providers, each where it may be used.** Availability is a table
   of capability × platform × country → provider or "not available".
   Jupiter is the default row; 0x is the row for every country Jupiter's
   terms exclude; no country gets 0x while Jupiter can serve it.
2. **United States: not available** on iOS, Android and the extension,
   until the owner confirms in writing. Opening it means adding 0x
   (Jupiter excludes the United States), a legal opinion for the United
   States, and the App Review evidence package described in the SOT's
   Apple Exchange Compliance Plan.
3. **Initial table, every platform:** unavailable in the comprehensively
   embargoed territories (Cuba, Iran, North Korea, Syria, and the Crimea,
   Donetsk and Luhansk regions) and in the United States; **0x** in the
   twelve other countries Jupiter names (Republic of China, Singapore,
   Myanmar, Côte d'Ivoire, DR Congo, Iraq, Libya, Mali, Nicaragua, Somalia,
   Sudan, Yemen, Zimbabwe), several of which sit under partial US sanctions
   programmes — counsel confirms that list before it goes live; **Jupiter**
   everywhere else.
4. **Wallet screening.** On a Jupiter row, Salmon screens the wallet
   address through TRM Labs' free screening service (answer cached per
   address for a day), with its own daily copy of the public sanctions list
   of the US Treasury as fallback when TRM does not answer. On a 0x row, 0x
   screens and Salmon renders its refusal as `wallet_restricted`. A paid
   screening plan only if counsel asks for one.
5. **Salmon fee: 50 bps** (decision of 2026-09-14, confirmed 2026-09-30),
   passed to the provider as Salmon's fee and delivered into a fee account
   Salmon controls (the multisig confirmed in DEV-54), shown on the
   confirmation screen as its own line. On a 0x row the user also pays 0x's
   0.15% while 0x charges it; the owner revisits the rate then.
6. **Plans:** 0x Standard and Jupiter Developer, both held by Salmon.

## What already exists, and is not to be rebuilt

- The build-only contract and the signing-boundary test (spec 010).
- `powerupGate` as the single seam, the `region` reason that travels to both
  client twins, and the client's handling of `403 region_restricted` and
  `403 wallet_restricted` (spec 011, frontend spec 027).
- The swap screens in the frontend, built and unmounted, waiting for a
  route (SOT, Swap Overview).
- The 0x adapter, fee-account resolution, fee verification, the
  `SwapBuild` response shape and their tests, on branch `feat/powerup-swap`.
  All of it is reused as is; this spec adds the Jupiter adapter, the table
  and the gate around both.
- The token catalogue, prices and attribution (spec 013).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A user swaps and Salmon never touches the signed transaction (Priority: P1)

A user in a country where swap is offered picks two tokens and an amount,
sees the amount in, the estimated amount out, the minimum after slippage,
the route provider ("Powered by Metis (Jupiter)"), the price impact, the USD values
and **the Salmon fee as its own line**, signs on the device, and the app
sends the transaction to the network itself.

**Why this priority**: It is the revenue path and the behaviour the store
answers describe.

**Independent Test**: The build endpoint returns a transaction whose
signature slots are all zero and whose fee payer is the caller; the fee
account appears among the accounts of the returned instructions; the
signing-boundary test still passes; the fee lands on-chain when the client
broadcasts (mainnet only — neither provider has a devnet).

**Acceptance Scenarios**:

1. **Given** a mainnet pair and amount from an allowed country, **When** a
   build is requested, **Then** the response carries an unsigned base64 v0
   transaction, `provider: 'jupiter'`, `attribution: 'Powered by Metis (Jupiter)'`,
   `input`/`output` legs with the minimum received, `route`, `slippageBps`,
   `expiresAt` and a `salmonFee` line of 50 bps.
2. **Given** the returned transaction, **When** decoded, **Then** it has no
   signature, its fee payer is the caller's public key, and the configured
   fee account is referenced by at least one instruction.
3. **Given** the transaction is signed on the device and broadcast, **When**
   it confirms, **Then** the fee account balance increases by the displayed
   fee within rounding.
4. **Given** the provider answers that no route exists or the pair is not
   supported, **When** a build is requested, **Then** 404 `no_route` with
   the provider's reason in `error_description`.
5. **Given** the wallet points at `solana-devnet`, **When** a build is
   requested, **Then** 400 `invalid_parameter` and no provider call.

---

### User Story 2 - The swap is offered only where it may be offered, per platform (Priority: P1)

Someone opens the wallet in a country on the blocked list. The catalogue
shows swap as unavailable in their region; the swap screen says so before
any quote; and a build request from that country is refused before any
provider is called. The same person on a different platform may get a
different answer, because the stores' rules differ.

**Why this priority**: It is what Jupiter's terms require of Salmon (no
wallet in its prohibited localities), what 0x's licence makes Salmon warrant
(§8.2(b)), what Apple's guideline 3.1.5(iii) asks about, and the owner's
United States decision.

**Independent Test**: With the table configured, requests carrying a blocked
country header get `403 region_restricted` on the build route and
`enabled: false, reason: 'region'` on the availability route; requests from
an allowed country get a Jupiter build. Changing a row in the table changes
the answer on the next call, with no deploy.

**Acceptance Scenarios**:

1. **Given** the caller's country is on the blocked list for their
   platform, **When** availability is requested, **Then** swap comes back
   `enabled: false, reason: 'region'`, and the catalogue renders the reason
   it already knows.
2. **Given** the same caller, **When** a build is requested, **Then**
   `403 region_restricted` and no provider is called.
3. **Given** the caller's country is allowed for their platform, **When**
   availability is requested, **Then** swap comes back enabled with
   `provider: 'jupiter'`, and a build succeeds.
4. **Given** the country cannot be resolved, **When** a build is requested,
   **Then** it proceeds and the failure to resolve is logged (a denylist
   that cannot resolve has not found a blocked country).
5. **Given** the request did not arrive through the edge, **When** any build
   is requested, **Then** it is refused before the country is read.
6. **Given** the owner removes a country from the blocked list in
   configuration, **When** the next request arrives, **Then** it is served,
   with no release and no client update.
7. **Given** the United States as the caller's country, **When** anything
   is requested on any platform, **Then** swap is unavailable, until the
   owner's written confirmation changes the table.

---

### User Story 3 - A sanctioned wallet cannot swap (Priority: P1)

A caller whose wallet address is sanctioned asks for a build. On a Jupiter
row (the default), the backend refuses before calling Jupiter, from its own
copy of the list. On a 0x row, 0x refuses and the backend renders
`wallet_restricted`.
Either way the app shows the unavailable state it already has for a
restricted wallet.

**Why this priority**: Jupiter's licence §7.3 makes screening Salmon's duty
on every Jupiter request; 0x performs it inside its own request and that
cannot be reused for another provider.

**Independent Test**: On a 0x row, a 403 from the provider maps to
`wallet_restricted`. On a Jupiter row, a known listed address as `publicKey`
answers `403 wallet_restricted` with no provider call; a clean address
proceeds. The list refresh runs daily and a failed refresh keeps the last
good copy.

**Acceptance Scenarios**:

0. **Given** a 0x row and a wallet 0x refuses, **When** a build is
   requested, **Then** `403 wallet_restricted`, and the refusal is logged
   without the address next to a country.
1. **Given** a Jupiter row and a wallet address on Salmon's list, **When** a
   build is requested, **Then** `403 wallet_restricted` and no provider
   call.
2. **Given** a Jupiter row and a list not refreshed in more than 48 hours,
   **When** a build is requested, **Then** the last copy is used and the
   staleness is logged as an error.
3. **Given** a Jupiter row and no copy of the list at all, **When** a build
   is requested, **Then** 503 `upstream_unavailable` — screening cannot be
   skipped silently. A 0x row is unaffected: no local list is needed.
4. **Given** a listed address, **When** anything other than a swap build is
   requested (balance, history, send), **Then** it works as today:
   screening is a condition of the swap, not of the wallet.

---

### User Story 4 - The second provider serves where the first cannot, without touching the apps (Priority: P1)

A user in a country Jupiter refuses to serve gets the same swap through
0x: the table row names `0x`, the 0x adapter builds, and the apps render
"Powered by 0x" and 0x's fee line with no client branch. The same mechanism
opens the United States the day the owner confirms it: one row per
platform.

**Acceptance Scenarios**:

1. **Given** a table row that names `0x`, **When** a build is requested
   from that country and platform, **Then** the 0x adapter builds it and the
   response carries `provider: '0x'` in the same shape, with Salmon's fee
   and 0x's own fee as separate lines.
2. **Given** a table row that names a provider whose credential is not
   configured, **When** a build is requested, **Then** 503
   `upstream_unavailable` and an error log, never a silent fallback to the
   other provider (the other provider may not serve that country).
3. **Given** a row that names `jupiter` for a country on Jupiter's
   prohibited list, **When** the configuration is loaded, **Then** it is
   rejected as invalid and logged; the previous table stays in force.

### Edge Cases

- **Platform signal.** The apps send their platform (`ios`, `android`,
  `extension`) on every request. A modified client can lie; that does not
  matter for the stores, whose rules bind the build they reviewed, and it
  cannot open a country that is blocked on every platform. A request with
  no platform is treated as the most restrictive platform.
- **Blockhash expiry.** The backend reports `expiresAt`; the client
  requests a fresh build after it. Builds are never cached.
- **Token-2022 mints with transfer fees or hooks.** Not routed by either
  provider → 404 `no_route` with the provider's reason.
- **Native SOL.** The fee recipient is the fee-account owner's wallet; any
  other token pays the owner's associated token account.
- **Fee account missing for the output token.** Same policy as spec 012:
  fee on the input token if Salmon holds an account for it, else a fee-less
  swap with `[SWAP_FEE_SKIPPED]` logged as an error. A build whose
  instructions never reference the chosen fee account answers 502
  `provider_fee_mismatch`.
- **Rate limits.** Jupiter Developer is 10 requests per second and 0x
  Standard 5; a process-wide limiter per provider fronts the calls, and a
  429 reads as `upstream_rate_limited`, which the existing alert counts.
  The client quotes on confirm and on a timer, never on every keystroke.
- **Provider outage.** The provider's circuit opens after repeated
  failures → 503 `upstream_unavailable`; no fallback to another provider.
- **Traveller.** Nothing is stored on the device; the answer is per
  request, so leaving and returning needs no reinstall.
- **Offline.** No network, no quote; the availability answer is part of the
  same request, not a separate step.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `GET /v1/solana-mainnet/ft/swap/build` MUST ask the
  provider named by the availability row for the swap instructions with
  Salmon's fee (50 bps) and fee account, compile them into an unsigned v0
  transaction with the caller as fee payer, and return the `SwapBuild` shape
  of spec 012 with the provider's name. On any other network it MUST answer
  400 before any provider call. The 0x path is the one spec 012
  implemented; the Jupiter path uses Jupiter's Router build endpoint with
  Salmon's fee as `platformFeeBps` into Salmon's fee account.
- **FR-002**: The client MUST NOT be able to influence fee parameters; only
  `inputMint`, `outputMint`, `publicKey`, `amount` / `uiAmount` and
  `slippageBps` are read from the request.
- **FR-003**: The backend MUST NOT expose any route that accepts a signed
  transaction or broadcasts one (spec 010).
- **FR-004**: Availability MUST be a configuration table keyed by
  capability, platform and country whose value is a provider name or
  "unavailable", changeable without a deploy, with the initial rows of
  owner decision 3. The availability route (spec 011) MUST return the
  provider name alongside `enabled`.
- **FR-005**: The build route MUST be wrapped by `powerupGate('swap')`,
  which MUST read the country resolved at the edge and the platform sent by
  the app, look the pair up in the table, and answer `403 region_restricted`
  before any provider call when the row is "unavailable". An unresolved
  country MUST be treated as unrestricted and logged. A request that did not
  arrive through the edge MUST be refused before the country is read.
- **FR-006**: The apps MUST send their platform on every request to the
  backend. A request without it MUST be evaluated as the most restrictive
  platform.
- **FR-007**: On a row that names a provider which does not screen wallet
  addresses itself (Jupiter, the default), the backend MUST screen
  `publicKey` against a locally held copy of the US Treasury sanctions
  list's digital-currency addresses before the build, answer
  `403 wallet_restricted` on a match, refresh the copy daily, serve the
  last copy when a refresh fails (logging the staleness after 48 hours),
  and answer 503 when no copy exists. On a 0x row the provider's refusal
  MUST be rendered as `wallet_restricted`.
- **FR-008**: The provider adapter MUST be selected from the table row, and
  a row naming a provider without a configured credential MUST answer 503,
  never fall back to another provider. A row naming Jupiter for a country on
  Jupiter's prohibited list MUST be rejected when the configuration loads.
- **FR-009**: Each provider's wire format MUST stay inside its adapter
  (`zeroex-swap-provider`, existing; `jupiter-swap-provider`, new), both
  returning the same internal shape (`{ instructions, lookupTableAddresses,
amountOut, minAmountOut, routePlan, providerRequestId }`), so the build
  service does not branch on provider.
- **FR-010**: Fee and provider configuration (`ZEROEX_API_KEY`,
  `ZEROEX_MAX_RPS`, `JUPITER_API_KEY`, `JUPITER_MAX_RPS`, `SWAP_FEE_BPS`,
  `SWAP_FEE_ACCOUNT_OWNER`, and the availability table) MUST live in
  SSM/env; the fee account owner's private key MUST never be in the repo,
  the apps or any system Salmon runs.
- **FR-011**: The backend MUST NOT persist a country, a platform, a
  screening result or anything else per wallet or per user. Logs MUST
  record the country code and the refusal, never the address next to the
  country.
- **FR-012**: `docs/openapi.yaml`, `AGENTS.md`, `.env.example` and
  `CHANGELOG.md` MUST be updated; the SOT's Swap and Apple documents are
  updated when the feature ships, not before.
- **FR-013**: Unit tests with recorded Jupiter fixtures at the adapter,
  service, resource and controller layers; gate tests for every table
  outcome; a screening test with a listed address on a Jupiter row; and one
  nightly integration test per provider asserting the fee instruction is
  present and the transaction is unsigned.

### Key Entities

- **Availability table**: rows of (capability, platform, country) → provider
  | unavailable; configuration, not code; every change carries who approved
  it and when, outside the repo.
- **Build response**: the `SwapBuild` shape of spec 012, provider-agnostic.
- **Provider adapter**: one per provider (Jupiter new, 0x existing), same
  internal shape out.
- **Sanctions copy**: the set of digital-currency addresses from the US
  Treasury list, with the time it was fetched.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of build responses decode to an unsigned transaction
  whose instructions reference the configured fee account (fixtures), and
  the realized on-chain fee is within rounding of the displayed one
  (nightly).
- **SC-002**: The signing-boundary test passes with the swap route present.
- **SC-003**: A build request from every country on the blocked list, on
  every platform, is refused without a provider call; one from an allowed
  country succeeds; and a table change takes effect on the next request
  with no deploy (asserted in tests with a mocked provider).
- **SC-004**: A build for a listed address is refused without a provider
  call; a request to any non-swap route for the same address is unaffected.
- **SC-005**: Switching a table row between `0x` and `jupiter` produces a
  valid build in the same shape with no client change (fixture test with
  both adapters).
- **SC-006**: The wallet's swap screens work against the response with no
  provider-specific branches (frontend spec 027).

## Assumptions

- Jupiter Developer (10 requests per second) covers the initial volume;
  0x Standard (5) covers the countries it serves.
- 0x's 0.15% fee is charged on-chain to the user on 0x rows only; while
  the Solana beta waives it the user pays Salmon's 50 bps, and 65 bps once
  it applies. The owner revisits the rate then.
- Jupiter Router's build endpoint keeps returning instructions, lookup
  tables and a blockhash with expiry, and takes no fee on that path
  (documentation read 2026-09-30).
- Fee token accounts for the mints users swap into most (SOL wallet, USDC,
  USDT at least) are created by ops before the fee is enabled.
- The country arrives from CloudFront as a viewer-country header and the
  API refuses direct callers (DEV-22); until that lands, the gate is
  testable but the country is forgeable.
- Store country availability for iOS is kept in step with the table by
  hand; it has no owner yet.
- Both provider plans are paid by Salmon (0x confirmed by the owner in the
  dashboard on 2026-09-30; Jupiter's key verified on the Developer plan).

## What this gate is not

Unchanged from spec 011: it is not evidence of the licensing App Review
asks for, not the identity-corroborated geo-block the UK regulator
describes, and not a wall. It states where Salmon offers the capability.

## Out of scope

- Opening the United States, and everything it needs (a legal opinion for
  the United States and the App Review evidence package; the 0x contract is
  in place).
- A paid screening provider that traces funds rather than matching
  addresses.
- Cross-chain swaps and on/off ramps.
- Re-reading 0x's licence of 2026-09-23 against the research of 2026-09-10.
