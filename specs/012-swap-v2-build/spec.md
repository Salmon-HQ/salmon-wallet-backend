# Feature Specification: Swap v2 — build on the backend, sign and send on the device

**Feature Branch**: `012-swap-v2-build`

**Created**: 2026-09-02

**Status**: Draft — approved for later implementation, not started

**Input**: User description: "Token swap rebuilt on Jupiter /swap/v2/build: backend returns an unsigned transaction with the Salmon fee, the client signs and broadcasts, gated by region and wallet screening"

> **Implementation note:** this spec was written ahead of time. When
> implementing, **create a fresh branch from `main`**. Depends on spec 010
> (signing boundary — the new routes must pass its allowlist as GET-only
> quote/build endpoints) and spec 011 (region gating — the routes mount
> `powerupGate('swap')`). The frontend side is spec 027 in
> `salmon-wallet-frontend`. Do not start before the owner enables at least
> one country in the Swap allowlist and confirms the fee account.

## Context

The previous swap relayed the user's signed transaction through the
backend to Jupiter Ultra's `/execute` (removed by spec 010). That path
made the backend "handle the transaction with the exchange directly" —
the question Apple's 3.1.5(iii) review asks — and Ultra itself is now
deprecated by Jupiter.

Jupiter documents `GET /swap/v2/build` as the path for integrators who
"build the transaction yourself… submit via your own RPC", with the
integrator fee (`platformFeeBps` + `feeAccount`) written into the
transaction and **no Jupiter swap fee** on that route. That fits the
signing boundary exactly: the backend asks Jupiter for the transaction
with Salmon's fee inside, returns it unsigned, the user reviews and
signs on the device, the app broadcasts to its own RPC, and the backend
only ever reads public status. The fee is an instruction in the
transaction the user signs, so it survives the move — and Jupiter's 20%
cut on referral fees (Ultra) does not apply here.

Trade-offs accepted (from Jupiter's docs): no JupiterZ/RFQ pricing (5–20
bps better on major pairs per Jupiter), no automatic gasless, no Beam
landing/MEV privacy; the client owns retry and confirmation like it does
for a normal send.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A user swaps and Salmon never touches the signed transaction (Priority: P1)

A user in an allowed country requests a quote, sees the amount in, the
estimated amount out, the route provider, price impact, slippage, the
network fee and **the Salmon fee as its own line**, signs on the device,
and the app sends the transaction to the network itself.

**Why this priority**: This is the Powerup's revenue path and the exact
behaviour the Apple answer and the legal position describe.

**Independent Test**: The build endpoint returns a transaction with no
signatures; decoding it shows a transfer of the fee to Salmon's fee
account; the backend has no route that accepts the signed bytes
(spec 010 test); the fee lands on-chain when the client broadcasts.

**Acceptance Scenarios**:

1. **Given** an allowed country and a clear wallet, **When** a build is
   requested for a pair/amount, **Then** the response carries an
   unsigned transaction, the provider, and separate fee lines.
2. **Given** the returned transaction, **When** decoded, **Then** it
   contains Salmon's fee instruction to the configured fee account at the
   configured bps, and no signature.
3. **Given** the transaction is signed on the device and broadcast,
   **When** it confirms, **Then** the fee account balance increases by
   the displayed fee.
4. **Given** Jupiter finds no route, **When** a build is requested,
   **Then** 404 with the provider's reason in `error_description`
   (kept from the old contract — the wallet classifies failures by that
   text).

---

### User Story 2 - The fee cannot be removed by a modified client (Priority: P1)

The fee parameters are decided by the backend from configuration; the
client sends only pair, amount, slippage and its public key.

**Acceptance Scenarios**:

1. **Given** a request that includes fee parameters, **When** built,
   **Then** they are ignored and the configured fee is applied.
2. **Given** the fee account for the chosen fee token does not exist,
   **When** a build is requested, **Then** 503 `fee_account_missing` —
   never a swap that silently pays no fee.

---

### User Story 3 - The swap respects region and screening (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a blocked or unknown country, **When** a quote or build is
   requested, **Then** 403 `region_restricted` and no Jupiter call.
2. **Given** a listed wallet, **When** a quote or build is requested,
   **Then** 403 `wallet_restricted` and no Jupiter call.

---

### User Story 4 - Provider attribution and future providers (Priority: P2)

The response names the provider so the app shows "Powered by Jupiter"
(required by Jupiter's license, which also requires stating which API is
used). The backend can later route some requests to another provider
without a client change.

**Acceptance Scenarios**:

1. **Given** any build response, **When** read, **Then** it carries
   `provider: 'jupiter'`, a display name and an attribution string.
2. **Given** a second provider adapter is registered, **When** selected
   by config for a country, **Then** the client receives the same shape
   with `provider: '0x'` or `'dflow'`.

### Edge Cases

- Blockhash expiry: the transaction expires ~60–90 s after build; the
  client must fetch a fresh build if the user waits. The backend does not
  cache builds.
- Token-2022 mints with transfer fees: pass through whatever Jupiter
  returns; do not "correct" amounts.
- Jupiter picks the fee token by its own priority (SOL → stables → LSTs
  → …); the fee account must exist for every token the config allows,
  which is why the response reports the fee **mint**.
- Rate limits: the backend's Jupiter key tier decides RPS; keep the
  existing Jupiter rate limiter in front of the new calls.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `GET /v1/solana-{env}/ft/swap/build` MUST call Jupiter
  `GET /swap/v2/build` with server-configured `platformFeeBps` and
  `feeAccount` and return `{ provider, providerDisplayName, attribution, transaction (base64, unsigned), input, output, route, priceImpactPct, slippageBps, salmonFee: { amount, mint, bps }, routeFee: { amount, mint } , expiresAt }`.
- **FR-002**: The client MUST NOT be able to influence fee parameters;
  any such query params are ignored.
- **FR-003**: The route MUST mount `powerupGate('swap', { addressParam: 'publicKey' })`
  (spec 011) and MUST be a GET (spec 010 allowlist).
- **FR-004**: No-route and provider 4xx MUST map to 404 with the
  provider's reason in `error_description`; provider 5xx/timeouts MUST
  map to 502/500 per `error-handler.js`.
- **FR-005**: A missing fee token account MUST be detected before
  returning a transaction and answered 503 `fee_account_missing`.
- **FR-006**: The backend MUST NOT expose any endpoint that accepts the
  signed transaction or broadcasts it; confirmation is read-only via
  existing RPC/history paths.
- **FR-007**: Provider access MUST go through a `SwapProvider` interface
  (`quote/build(params) → unified shape`) with Jupiter as the first
  implementation and provider selection by config (per country), so 0x /
  DFlow can be added without touching the route or the client.
- **FR-008**: Fee configuration (`SWAP_FEE_BPS`, `SWAP_FEE_ACCOUNT_OWNER`)
  MUST live in SSM/env like other secrets; the fee account owner key MUST
  never be in the repo or the app.
- **FR-009**: `docs/openapi.yaml`, `AGENTS.md` (new contract
  `solana-swap-build`), skills and `CHANGELOG.md` MUST be updated; the
  capability matrix `powerups.swap` MUST be the single switch.
- **FR-010**: Full CI gate; unit tests with recorded Jupiter fixtures;
  one `*.integration.spec.js` against Jupiter (nightly) asserting the fee
  instruction is present and the transaction is unsigned.

### Key Entities

- **Build response**: see FR-001.
- **SwapProvider**: adapter contract; Jupiter first.
- **Fee config**: bps + fee account owner; token accounts per allowed fee
  mint.

## Success Criteria _(mandatory)_

- **SC-001**: 100% of build responses decode to an unsigned transaction
  containing the configured fee instruction.
- **SC-002**: The signing-boundary test (spec 010) passes with the new
  routes present.
- **SC-003**: A request from a blocked country or listed wallet never
  reaches Jupiter (asserted with a mocked provider).
- **SC-004**: Salmon's realized fee per swap equals the displayed
  `salmonFee.amount` (checked in the nightly integration test on
  devnet/mainnet with a tiny amount).
- **SC-005**: Frontend spec 027's swap module works against the new
  shape with no provider-specific branches.

## Assumptions

- Owner confirms the fee bps and the fee account owner before
  implementation; token accounts for allowed fee mints are created by
  ops (Jupiter will not create them).
- Jupiter API key tier is sufficient for expected RPS; the existing
  `jupiter-rate-limiter` fronts the calls.
- Country allowlist for Swap is set in spec 011 config; at least one
  country is enabled, otherwise the endpoint answers 404 everywhere.
- Legal opinion per enabled territory exists before Swap is enabled in
  production (owner/counsel, outside the repo).

## Out of scope

- Client-side signing/broadcast/confirmation — frontend spec 027.
- 0x / DFlow adapters — separate features once their terms/pricing are
  confirmed; this spec only guarantees the interface.
- Gasless / RFQ routes.
