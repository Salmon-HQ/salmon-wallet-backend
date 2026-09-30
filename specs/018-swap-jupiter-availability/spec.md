# Feature Specification: Swap on Jupiter Router, offered where it may be offered

**Feature Branch**: `018-swap-jupiter-availability`

**Created**: 2026-09-30

**Status**: Draft — owner decisions of 2026-09-30 recorded below; not implemented

**Input**: User description: "Swap on Jupiter Router with availability by country, platform and provider; United States off until confirmed"

> Supersedes `specs/012-swap-v2-build` (0x, on branch `feat/powerup-swap`) as
> the swap spec, and amends `specs/011-capability-availability` (the gate)
> in the same branch. Depends on spec 010 (signing boundary): the route
> stays a GET-only build endpoint. The client side is frontend spec 027.

## Context

Salmon's swap is build-only: the backend returns an unsigned transaction,
the device signs it and broadcasts it to its own RPC, and the backend never
sees the signed bytes. That model is in production for NFTs and Powerups
(0.19.0) and is what the store answers rest on.

Two things changed since spec 012 chose 0x on 2026-09-10:

1. **Price.** 0x's public plans are USD 1,000 per month plus 0.15% per swap
   (Standard) and USD 2,500 (Enterprise); the pricing page shows no free
   tier, and the Solana beta's "zero swap fees" has no end date. Jupiter's
   Router path takes no fee, and the Developer plan is USD 25 per month for
   10 requests per second. The key already in production is on that plan
   (verified 2026-09-30 by its rate-limit headers).
2. **Territory.** The owner decided (2026-09-30) that the **United States is
   off** until confirmed explicitly, in every platform. Without the United
   States, every country Salmon offers swap in is a country Jupiter serves.

So Jupiter Router is the provider for the first release, and 0x becomes an
optional second provider for the day the United States or Jupiter's other
excluded countries are opened. The response shape the apps consume does not
change between providers: the provider name and attribution arrive as data.

Jupiter's terms shape two requirements of this spec:

- Jupiter "does not interact with digital wallets located in, established
  in, or a resident of" the United States, the Republic of China, Singapore,
  Myanmar, Côte d'Ivoire, Cuba, Crimea and Sevastopol, DR Congo, Iran, Iraq,
  Libya, Mali, Nicaragua, North Korea, Somalia, Sudan, Syria, Yemen,
  Zimbabwe, or any territory under US, UK or EU sanctions (Terms of Use,
  "Prohibited Localities").
- The API licence makes the integrator "perform transaction screening and
  monitoring of all digital wallets interacting with the Client's Product,
  including blocking of sanctioned ... digital wallets" (§7.3) and puts all
  KYC/AML duties on the integrator (§7.4). 0x screened addresses itself;
  with Jupiter, Salmon screens.

## Owner decisions (2026-09-30)

1. **Both providers, each where it may be used.** Availability is a table
   of capability × platform × country → provider or "not available". The
   first release fills it with Jupiter only.
2. **United States: not available** on iOS, Android and the extension,
   until the owner confirms in writing. Opening it means adding 0x
   (Jupiter excludes the United States), a legal opinion for the United
   States, and the App Review evidence package described in the SOT's
   Apple Exchange Compliance Plan.
3. **Initial blocked list, every platform:** the comprehensively embargoed
   territories (Cuba, Iran, North Korea, Syria, and the Crimea, Donetsk and
   Luhansk regions), the United States, and the twelve other countries
   Jupiter names (Republic of China, Singapore, Myanmar, Côte d'Ivoire,
   DR Congo, Iraq, Libya, Mali, Nicaragua, Somalia, Sudan, Yemen, Zimbabwe).
4. **Wallet screening with Salmon's own list** from the public sanctions
   list of the US Treasury (its digital-currency-address entries cover
   Solana), refreshed daily, exact match. A paid screening provider only if
   counsel asks for one.
5. **Salmon fee: 50 bps** (decision of 2026-09-14, unchanged), taken with
   Jupiter's `platformFeeBps` into a fee account Salmon controls, shown on
   the confirmation screen as its own line.
6. **Jupiter plan: Developer** (10 requests per second). Who pays the
   subscription is to be confirmed with the account owner.

## What already exists, and is not to be rebuilt

- The build-only contract and the signing-boundary test (spec 010).
- `powerupGate` as the single seam, the `region` reason that travels to both
  client twins, and the client's handling of `403 region_restricted` and
  `403 wallet_restricted` (spec 011, frontend spec 027).
- The swap screens in the frontend, built and unmounted, waiting for a
  route (SOT, Swap Overview).
- The 0x adapter, fee-account resolution, fee verification and the
  `SwapBuild` response shape, on branch `feat/powerup-swap`. The shape is
  reused verbatim; the adapter is kept for the second provider.
- The token catalogue, prices and attribution (spec 013).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A user swaps and Salmon never touches the signed transaction (Priority: P1)

A user in a country where swap is offered picks two tokens and an amount,
sees the amount in, the estimated amount out, the minimum after slippage,
the route provider ("Powered by Jupiter"), the price impact, the USD values
and **the Salmon fee as its own line**, signs on the device, and the app
sends the transaction to the network itself.

**Why this priority**: It is the revenue path and the behaviour the store
answers describe.

**Independent Test**: The build endpoint returns a transaction whose
signature slots are all zero and whose fee payer is the caller; the fee
account appears among the accounts of the returned instructions; the
signing-boundary test still passes; the fee lands on-chain when the client
broadcasts (mainnet only — Jupiter has no devnet).

**Acceptance Scenarios**:

1. **Given** a mainnet pair and amount from an allowed country, **When** a
   build is requested, **Then** the response carries an unsigned base64 v0
   transaction, `provider: 'jupiter'`, `attribution: 'Powered by Jupiter'`,
   `input`/`output` legs with the minimum received, `route`, `slippageBps`,
   `expiresAt` and a `salmonFee` line of 50 bps.
2. **Given** the returned transaction, **When** decoded, **Then** it has no
   signature, its fee payer is the caller's public key, and the configured
   fee account is referenced by at least one instruction.
3. **Given** the transaction is signed on the device and broadcast, **When**
   it confirms, **Then** the fee account balance increases by the displayed
   fee within rounding.
4. **Given** Jupiter answers that no route exists or the pair is not
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

**Why this priority**: It is what Jupiter's terms require of Salmon, what
Apple's guideline 3.1.5(iii) asks about, and the owner's United States
decision.

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

A caller whose wallet address appears on the sanctions list asks for a
build. The backend refuses before calling Jupiter, and the app shows the
unavailable state it already has for a restricted wallet.

**Why this priority**: Jupiter's licence §7.3 makes it Salmon's duty; with
0x it was the provider's.

**Independent Test**: With a known listed address as `publicKey`, the build
route answers `403 wallet_restricted` and no provider is called; with a
clean address, it proceeds. The list refresh runs daily and a failed refresh
keeps the last good copy.

**Acceptance Scenarios**:

1. **Given** a wallet address on the list, **When** a build is requested,
   **Then** `403 wallet_restricted` and no provider call.
2. **Given** the list has not been refreshed in more than 48 hours, **When**
   a build is requested, **Then** the last copy is used and the staleness
   is logged as an error.
3. **Given** no copy of the list exists at all, **When** a build is
   requested, **Then** 503 `upstream_unavailable` — screening cannot be
   skipped silently.
4. **Given** a listed address, **When** anything other than a swap build is
   requested (balance, history, send), **Then** it works as today:
   screening is a condition of the swap, not of the wallet.

---

### User Story 4 - The second provider slots in without touching the apps (Priority: P2)

The owner confirms the United States. Ops adds 0x's credential, sets the
table rows for the United States to `0x` on the platforms allowed, and the
apps render "Powered by 0x" on those requests with no client release.

**Acceptance Scenarios**:

1. **Given** a table row that names `0x`, **When** a build is requested
   from that country and platform, **Then** the 0x adapter builds it and the
   response carries `provider: '0x'` in the same shape.
2. **Given** a table row that names a provider whose credential is not
   configured, **When** a build is requested, **Then** 503
   `upstream_unavailable` and an error log, never a silent fallback to the
   other provider (the other provider may not serve that country).
3. **Given** the 0x row, **When** the wallet is screened, **Then** Salmon's
   own screening still runs first; 0x's is in addition.

### Edge Cases

- **Platform signal.** The apps send their platform (`ios`, `android`,
  `extension`) on every request. A modified client can lie; that does not
  matter for the stores, whose rules bind the build they reviewed, and it
  cannot open a country that is blocked on every platform. A request with
  no platform is treated as the most restrictive platform.
- **Blockhash expiry.** The backend reports `expiresAt`; the client
  requests a fresh build after it. Builds are never cached.
- **Token-2022 mints with transfer fees or hooks.** Not routed by Jupiter →
  404 `no_route` with the provider's reason.
- **Native SOL.** The fee recipient is the fee-account owner's wallet; any
  other token pays the owner's associated token account.
- **Fee account missing for the output token.** Same policy as spec 012:
  fee on the input token if Salmon holds an account for it, else a fee-less
  swap with `[SWAP_FEE_SKIPPED]` logged as an error. A build whose
  instructions never reference the chosen fee account answers 502
  `provider_fee_mismatch`.
- **Rate limits.** Jupiter Developer is 10 requests per second; a
  process-wide limiter fronts the calls, and 429 from Jupiter reads as
  `upstream_rate_limited`, which the existing alert counts.
- **Provider outage.** The provider's circuit opens after repeated
  failures → 503 `upstream_unavailable`; no fallback to another provider.
- **Traveller.** Nothing is stored on the device; the answer is per
  request, so leaving and returning needs no reinstall.
- **Offline.** No network, no quote; the availability answer is part of the
  same request, not a separate step.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `GET /v1/solana-mainnet/ft/swap/build` MUST ask Jupiter's
  Router build endpoint with Salmon's fee (50 bps, `platformFeeBps`) and
  fee account, compile the returned instructions into an unsigned v0
  transaction with the caller as fee payer, and return the `SwapBuild` shape
  of spec 012 with `provider: 'jupiter'`. On any other network it MUST
  answer 400 before any provider call.
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
- **FR-007**: The backend MUST screen `publicKey` against a locally held
  copy of the US Treasury sanctions list's digital-currency addresses
  before every swap build, answer `403 wallet_restricted` on a match, refresh
  the copy daily, serve the last copy when a refresh fails (logging the
  staleness after 48 hours), and answer 503 when no copy exists.
- **FR-008**: The provider adapter MUST be selected from the table row, and
  a row naming a provider without a configured credential MUST answer 503,
  never fall back to another provider.
- **FR-009**: The Jupiter wire format MUST stay inside a
  `jupiter-swap-provider` adapter returning the same internal shape as the
  0x adapter (`{ instructions, lookupTableAddresses, amountOut, minAmountOut,
routePlan, providerRequestId }`), so the build service does not branch on
  provider.
- **FR-010**: Fee and provider configuration (`JUPITER_API_KEY`,
  `JUPITER_MAX_RPS`, `SWAP_FEE_BPS`, `SWAP_FEE_ACCOUNT_OWNER`, the 0x
  variables from spec 012, and the availability table) MUST live in
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
  outcome; a screening test with a listed address; and one nightly
  integration test against Jupiter asserting the fee instruction is present
  and the transaction is unsigned.

### Key Entities

- **Availability table**: rows of (capability, platform, country) → provider
  | unavailable; configuration, not code; every change carries who approved
  it and when, outside the repo.
- **Build response**: the `SwapBuild` shape of spec 012, provider-agnostic.
- **Provider adapter**: one per provider (Jupiter now, 0x kept), same
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
- **SC-005**: Switching a table row to `0x` produces a valid build in the
  same shape with no client change (fixture test with both adapters).
- **SC-006**: The wallet's swap screens work against the response with no
  provider-specific branches (frontend spec 027).

## Assumptions

- The Jupiter Developer plan (10 requests per second) covers the initial
  volume; a higher plan is a portal change plus `JUPITER_MAX_RPS`.
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
- Jupiter's plan is paid by someone on the team; the owner confirms who.

## What this gate is not

Unchanged from spec 011: it is not evidence of the licensing App Review
asks for, not the identity-corroborated geo-block the UK regulator
describes, and not a wall. It states where Salmon offers the capability.

## Out of scope

- Opening the United States, and everything it needs (0x contract and
  price, a legal opinion, the App Review evidence package).
- A paid screening provider that traces funds rather than matching
  addresses.
- Cross-chain swaps and on/off ramps.
- Re-reading 0x's licence of 2026-09-23 against the research of 2026-09-10.
