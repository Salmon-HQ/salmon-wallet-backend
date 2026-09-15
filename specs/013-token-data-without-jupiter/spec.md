# Feature Specification: Token data without Jupiter

**Created**: 2026-09-11

**Status**: Draft — approved by the owner for implementation on this branch

## Context

The wallet shows Solana tokens in four places, and all four are fed by Jupiter
today: the token picker (verified list + free-text search), the balance
not mention their data APIs, but their "Prohibited Localities" clause (United
States among them) and the licence's incorporation of those terms leave the
The owner decided to remove the doubt by removing Jupiter.

Two sources replace it, both cleared for US users (research:
node provider Salmon already pays for, whose Digital Asset Standard API
describes any mint (symbol, name, decimals, logo, token program, Token-2022
extensions) in batches of up to 1000, and CoinGecko, whose curated Solana
token list and per-contract prices cover every token that matters to a
mainstream wallet, at the cost of a paid plan and a visible attribution.

What is deliberately given up (owner decision 2026-09-11): a USD value and
a name search for tokens CoinGecko has not listed (fresh memecoins,
long-tail), Jupiter's `organicScore` quality signal, and a monthly fee for
the CoinGecko plan. What is gained: no Jupiter dependency, a stable
the Token-2022 mints the routing provider cannot trade.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The token picker keeps working, without Jupiter (Priority: P1)

shows the curated Solana tokens with logo, symbol, name and decimals, and
typing "bonk" or a mint address finds the token. Behind the scenes no call
reaches Jupiter.

**Why this priority**: The picker is the entry point to every token flow;
if it regresses the wallet is unusable for tokens.

**Independent Test**: With every Jupiter hostname blocked at the network
level, the verified list is non-empty, USDC/SOL/BONK appear in it, a search
for "usdc" returns USDC first, a search for a full mint address returns
exactly that token, and the response shape is byte-compatible with today's.

**Acceptance Scenarios**:

1. **Given** the catalog is warm, **When** the verified list is requested,
   **Then** it returns the curated tokens with `tags` containing `verified`
   and a populated `coingeckoId`, in the same shape as today.
2. **Given** a query like "bonk", **When** search is requested, **Then**
   tokens whose symbol or name contain the query are returned, exact symbol
   matches first, within one second.
3. **Given** a query that is a valid mint address **not** in the catalog,
   **When** search is requested, **Then** that single token is returned with
   its on-chain metadata and `tags: []` (not verified), so a user can still
   reach an unlisted token by address.
4. **Given** the catalog source is unreachable and no cached copy exists,
   **When** the list is requested, **Then** the request fails with a
   provider error (never an empty list presented as "no tokens").

---

### User Story 2 - The balance keeps its logos, USD values and spam filter (Priority: P1)

A user opens the home screen. Every SPL token in the wallet shows logo,
name, symbol, decimals; listed tokens show a USD value and a 24h change;
unlisted junk stays hidden by default exactly as today.

**Why this priority**: The balance is the most viewed screen and the one
where a regression is immediately noticed.

**Independent Test**: For a wallet holding SOL, USDC and an unlisted
memecoin, with Jupiter blocked: SOL and USDC carry `_price`, `_usdBalance`,
`_priceChange24h`; the memecoin carries metadata but no price; the
default listing hides tokens that are neither listed nor held in a
meaningful amount, by the same rule as before.

**Acceptance Scenarios**:

1. **Given** a balance with N distinct mints, **When** it is enriched,
   **Then** metadata for all N mints is resolved in at most two provider
   calls (one for metadata, one for prices), so the balance still answers
   within the existing budget.
2. **Given** a mint not listed on CoinGecko, **When** enriched, **Then** it
   keeps symbol/name/logo from on-chain metadata, gets `tags: []`, and no
   USD fields — never a 0 USD value presented as a fact.
3. **Given** the price source is down, **When** the balance is requested,
   **Then** items come back without USD fields and the response is still
   200 (prices are decoration; the balance itself is the truth).

---

A user picks a Token-2022 mint with a transfer fee or transfer hook as the

**Why this priority**: Avoids the dead-end `token_not_supported` on the
review screen; depends on story 1's metadata path.

**Independent Test**: A build request whose input or output mint has a
transfer fee or transfer hook is refused with `token_not_supported`
before any call to the routing provider; a Token-2022 mint without those
extensions builds normally.

**Acceptance Scenarios**:

1. **Given** an output mint with a transfer fee > 0, **When** a build is
   requested, **Then** 422 `token_not_supported` and the routing provider is
   not called.
2. **Given** a Token-2022 mint whose extensions are all routable, **When** a
   build is requested, **Then** it proceeds as today.
3. **Given** the catalog and search results, **When** a token is
   grey it out (additive field, defaults to `true`).

---

The review screen keeps showing input/output symbol, name, logo, decimals,
the USD value of both sides and the price impact, now sourced without
Jupiter.

**Acceptance Scenarios**:

1. **Given** a build for two listed tokens, **When** decorated, **Then**
   `input`/`output` carry symbol, name, logo, decimals and both USD values
   are present.
2. **Given** an unlisted output token, **When** decorated, **Then** the
   output USD value and `priceImpactPct` are `null`, the transaction is
   still returned.

---

### User Story 5 - CoinGecko is credited (Priority: P3)

Wherever a CoinGecko-sourced price or list is shown, the wallet shows the
"Data provided by CoinGecko" attribution required by their terms.

**Acceptance Scenarios**:

1. **Given** the network catalog is requested, **When** read, **Then** it
   carries the attribution text and link the clients must render, so the
   wording lives in one place.

### Edge Cases

- A mint present on CoinGecko but absent from on-chain metadata (rare,
  malformed metadata): the catalog entry wins for symbol/name/decimals.
- A token whose on-chain symbol differs from CoinGecko's: the on-chain
  symbol is what the user sees on the balance; the catalog symbol is what
  search matches. Both are indexed for search.
- Native SOL: never comes from a provider; the constant in the codebase
  keeps describing it, and its price is resolved like any listed mint.
- Devnet/testnet: CoinGecko has no lists for them; the existing static
  registry fallback stays for non-mainnet environments.
- CoinGecko terms cap caching at 24 hours: the catalog snapshot and prices
  are refreshed within that window; nothing derived from CoinGecko data is
  persisted beyond it.
- A wallet with more than 515 distinct mints (the price source's per-call
  cap): prices are fetched in chunks.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: No production code path MUST call any Jupiter hostname or
  read a `JUPITER_*` variable; the only Jupiter references left are the
  on-chain program ids used to classify past transactions.
- **FR-002**: The verified list (`/ft/verified`) MUST be served from the
  CoinGecko Solana token list, cached for at most 24 hours, with `tags`
  containing `verified` and `coingeckoId` populated, in the existing shape.
- **FR-003**: Search (`/ft/search`) MUST match the query against symbol,
  name and mint address of the catalog, rank exact symbol matches first,
  and, when the query is a valid mint address absent from the catalog,
  resolve it from on-chain metadata and return it unverified.
- **FR-004**: Per-mint metadata (symbol, name, decimals, logo, token program,
  Token-2022 extensions) MUST come from the node provider's Digital Asset
  Standard API in batches, cached per mint for at least one hour.
- **FR-005**: USD price and 24h change MUST come from CoinGecko's
  per-contract price endpoint, chunked at its per-call limit, cached for at
  most the window its terms allow, and absent (not zero) for unlisted mints.
- **FR-006**: The balance spam rule MUST keep hiding tokens that carry no
  `verified` tag, with `verified` now meaning "listed on CoinGecko".
- **FR-007**: A build request whose input or output mint carries a
  transfer-fee or transfer-hook extension MUST answer 422
  `token_not_supported` before calling the routing provider; catalog and
- **FR-008**: The network catalog response MUST carry the CoinGecko
  attribution (`text`, `url`) so clients render it from data.
- **FR-009**: `JUPITER_PRICE_URL`, `JUPITER_API_KEY`, the Jupiter services,
  the Jupiter rate limiter, the `cache.jup.ag` list and the unused
  `@jup-ag/api` dependency MUST be removed from code, config, docs, CI and
  the SSM parameter list; a `COINGECKO_API_KEY` on a paid plan becomes
  required for mainnet prices and catalog.
- **FR-010**: Public shapes of `/ft/verified`, `/ft/search`, the multichain
  (additive fields only).
- **FR-011**: The full CI gate MUST pass; every removed Jupiter behaviour
  MUST have an equivalent test against the new sources.

### Key Entities

- **Catalog entry**: a listed token — mint, symbol, name, decimals, logo,
  24h snapshot.
- **Mint metadata**: on-chain description of any mint — symbol, name,
  decimals, logo, token program, extensions. Source: node provider DAS,
  per-mint cache.
- **Price quote**: `usdPrice`, `priceChange24h` per mint. Source: CoinGecko,
  short cache.
- **Routability**: derived from extensions — `false` when transfer fee > 0,
  transfer hook set, or non-transferable.

## Success Criteria _(mandatory)_

- **SC-001**: With every Jupiter hostname unreachable, the verified list,
  wallet holding SOL, USDC and one unlisted token.
  work with zero client changes other than rendering the attribution and
- **SC-003**: A search for a top-100 Solana token by symbol returns it as the
  first result in under one second on a warm cache.
- **SC-004**: A balance of 50 distinct mints resolves metadata and prices in
  no more than 3 provider calls and stays within the existing response
  budget.
- **SC-005**: `grep -rin jupiter src config .env.example docs/openapi.yaml`
  matches only the transaction parser, program-id constants and their tests.

## Assumptions

- The owner subscribes to CoinGecko Basic (or higher) before this ships to
  production; the Demo key is not licensed for a fee-earning app. The
  existing `COINGECKO_API_KEY` variable is reused.
- The node provider's DAS endpoint on the current plan answers
  `getAssetBatch` with fungible display options (probed 2026-09-11) and its
  written terms carry no geographic clause beyond sanctions (to be confirmed
  in writing by the owner; not blocking).
- Helius `price_info` is NOT used in this feature; it remains a possible
  fallback for unlisted-token prices in a later feature.
- The frontend renders the attribution from the catalog data and treats
  informed 2026-09-11).

## Out of scope

- Prices or name search for tokens CoinGecko does not list.
- Any change to the Bitcoin token/price path (CoinGecko jobs stay as they
  are).
- Region gating (spec 011) and the community Powerups model.
