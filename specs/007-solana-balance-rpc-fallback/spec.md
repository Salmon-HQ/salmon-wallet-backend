# Feature Specification: Solana balance RPC fallback

**Feature Branch**: `007-solana-balance-rpc-fallback`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "Fall back to the bare Solana RPC when Blockdaemon balance lookup times out or fails upstream"

## Context

`GET /v1/solana-mainnet/account/:address/balance` answers 500
"The upstream provider is unavailable" for every wallet. Measured
2026-09-02 from the local backend with the production key: Blockdaemon
Universal answers 200 but in 9–21 s depending on wallet size; the backend
caps that call at 6 s, so every request trips the timeout. The mobile app
cannot load tokens. Same code path and same cap in production.

The backend already has a working bare-RPC path for Solana
(`locals.network.config.nodeUrl` — Triton when configured, else Helius),
which AGENTS.md requires to remain functional. That RPC answers the two
calls needed for a balance (native lamports + parsed token accounts) in
about a second.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Balances load when Blockdaemon is slow or down (Priority: P1)

A wallet user opens their Solana balance and sees SOL plus their SPL tokens
even when Blockdaemon does not answer within the backend's budget.

**Why this priority**: This is the outage. Without it the wallet shows
nothing for every user.

**Independent Test**: Simulate Blockdaemon timing out / answering 5xx and
assert the response still lists the native balance and every token account,
in the existing response shape.

**Acceptance Scenarios**:

1. **Given** Blockdaemon exceeds its timeout, **When** a balance is
   requested, **Then** the response is 200 with SOL and all SPL tokens
   (classic and Token-2022) sourced from the RPC, same shape as today.
2. **Given** Blockdaemon answers 5xx, **When** a balance is requested,
   **Then** same as above.
3. **Given** Blockdaemon answers normally, **When** a balance is requested,
   **Then** behaviour is byte-identical to today (no fallback, no extra
   calls).

---

### User Story 2 - Caller errors still surface as caller errors (Priority: P1)

An invalid or unknown address still gets the mapped 4xx it gets today; the
fallback never masks a bad request.

**Why this priority**: AGENTS.md — never answer 200 with a degraded payload;
4xx from upstream is the caller's problem, not ours.

**Independent Test**: Blockdaemon answering 400/404 propagates unchanged.

**Acceptance Scenarios**:

1. **Given** Blockdaemon answers 4xx, **When** a balance is requested,
   **Then** the error propagates to the error middleware unchanged and the
   RPC is not called.

---

### User Story 3 - Both providers down fails loudly (Priority: P2)

If Blockdaemon and the RPC both fail, the request fails with the standard
error envelope — never an empty balance.

**Acceptance Scenarios**:

1. **Given** Blockdaemon times out and the RPC rejects, **When** a balance
   is requested, **Then** the RPC error propagates (500 via the middleware)
   and no empty array is returned.

---

### Edge Cases

- A wallet with several token accounts for the same mint (ATA + auxiliary):
  the fallback aggregates amounts per mint so the wallet sees one row per
  token, as Blockdaemon presents it.
- Tokens with no Jupiter metadata: `symbol`/`name` come back `null` from the
  fallback (Blockdaemon supplied thin values there). The existing spam
  filter already hides untagged tokens by default, so the visible list is
  unchanged for verified tokens; `?includeSpam=true` may show `null` names.
- Zero-balance token accounts: filtered by the existing zero-amount filter.
- The whole request must fit under API Gateway's fixed 29 s: 6 s Blockdaemon
  budget + ~1–2 s RPC + Jupiter enrichment. No change to function timeouts.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: When the Blockdaemon balance call fails with a transport
  error (timeout, no response) or a 5xx, the system MUST obtain the balance
  from the network's configured RPC instead.
- **FR-002**: When Blockdaemon answers 4xx, the system MUST propagate that
  error and MUST NOT call the RPC.
- **FR-003**: The fallback MUST return native SOL plus every SPL token
  account under both the Token and Token-2022 programs, aggregated per mint.
- **FR-004**: The fallback MUST produce items in the same internal shape as
  Blockdaemon's so enrichment, filters and the public resource are unchanged.
- **FR-005**: The public `multichain-account-balance` response shape MUST
  be unchanged.
- **FR-006**: The fallback MUST log that it engaged (one warning line with
  the reason) so the outage is visible in CloudWatch.
- **FR-007**: A fallback failure MUST propagate; the system MUST NOT return
  an empty list.
- **FR-008**: The Blockdaemon timeout and function timeouts MUST NOT change.

### Key Entities

- **Balance item (internal)**: `{ owner, blockchain, confirmed_balance,
currency: { type, symbol, name, decimals, asset_path, detail? } }` —
  Blockdaemon's shape, produced by both providers.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: With Blockdaemon unreachable, 100% of balance requests for
  valid addresses answer 200 within the API Gateway limit.
- **SC-002**: With Blockdaemon healthy, zero additional upstream calls and a
  byte-identical response.
- **SC-003**: Unit tests cover: fallback on timeout, fallback on 5xx, no
  fallback on 4xx, RPC failure propagates, per-mint aggregation, Token-2022
  inclusion.
- **SC-004**: Existing balance-provider and resource tests pass unmodified.

## Assumptions

- `locals.network.config.nodeUrl` is always set for Solana networks (it is,
  by `src/constants/networks.js`).
- Blockdaemon remains the primary source so token `symbol`/`name` for
  unlisted tokens keep coming from it when it is healthy.

## Out of scope

- Replacing Blockdaemon as the primary Solana balance source.
- Changing Blockdaemon's 6 s budget or any Lambda timeout.
