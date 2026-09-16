# Feature Specification: Activity reads what the wallet gained or lost, not the transfers a parser listed

**Feature Branch**: `feat/powerups-foundations` (spec folder `016-activity-wallet-delta`; the owner keeps one branch for this lot)

**Created**: 2026-09-16

**Status**: Draft — approved by the owner for implementation on this branch ("Apliquémoslo… nada de parches")

**Input**: User description: "Al desinstalar… revisando la app me encontré con una tx que debería figurar como un receive y figura como Sent, con filas repetidas de SOL a burn…Qxgt y el NFT dos veces. Que se suele hacer en la práctica? Hacelo como corresponde."

## Context

The Activity list and the transaction detail read `type`, `inputs` and
`outputs` from `GET /v1/{network}/account/{address}/transactions`. Today the
enriched mapper (`src/resources/solana/helius-transaction-resource.js`)
builds them by enumerating the provider's `nativeTransfers` and
`tokenTransfers` and choosing a side:

- when the wallet is both a sender and a receiver in a `TRANSFER`, the type
  is forced to `send` (`mapTransactionType`, the `return SEND` after the
  directional inference), so whatever the wallet received in the same
  transaction is dropped — only outputs are built for a `send`;
- every provider transfer becomes one leg, with no aggregation by asset:
  five identical fee transfers are five rows, a pNFT moved through two
  Metaplex instructions is two rows;
- a token moved between two of the wallet's own token accounts counts as
  sent, because `fromUserAccount === address`;
- the row's "To" is `outputs[0].destination`, which with several
  counterparties is whichever transfer the provider listed first.

Measured on the owner's wallet `7Q3H…as6n` (2026-09-14, three transactions
in one block through an account-cleanup service; see `research.md`):
`qTqrN…` shows "Sent −1 MNDFLK ×2, −0.000011 SOL ×5" when the wallet's net
change was **+0.0036 SOL and no NFT movement**; `YAFiJ…` shows five fees
sent to `burn68…Qxgt` when the net change was **+0.0100 SOL received**.

What wallets do in practice (Phantom, Backpack, Solflare): the row is
derived from the **wallet's net balance change per asset**, computed from
the ledger's pre/post balances, and the provider's transfers only name the
counterparty. Aggregation by asset, self-transfers netting to nothing,
protocol fees and rent folded into the net, and the provider's type used
as a hint for the icon, never as the source of direction.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A transaction says what actually happened to my balance (Priority: P1)

The owner cleans empty token accounts through a third-party service and
gets rent back. Activity shows one row: what came back, as received.

**Independent Test**: replay the real transactions `qTqrN…`, `YAFiJ…` and
`66Z9a…` (fixtures in `__tests__/fixtures/`) through the mapper.

**Acceptance Scenarios**:

1. **Given** a `TRANSFER` where the wallet paid fees to a vault and had
   rent returned from closed accounts, **When** the mapper runs, **Then**
   `inputs` holds one SOL leg with the net amount received, `outputs` is
   empty and `type` is `interaction` (the wallet signed it and only SOL
   came back from its own accounts — see FR-006).
2. **Given** a pNFT moved between two token accounts of the same wallet,
   **When** the mapper runs, **Then** no NFT leg appears in either list.
3. **Given** a transaction where the wallet only paid the fee (an approve,
   an account creation), **When** the mapper runs, **Then** both lists are
   empty and the type is `interaction`.

---

### User Story 2 - A plain send or receive keeps reading exactly as today (Priority: P1)

A USDC send to a friend, a SOL receive, an NFT sent to another wallet: the
row and the detail read as they do now — one leg, the counterparty, the
fee.

**Independent Test**: the existing resource suites (`Type Mapping`,
`Inputs/Outputs for SEND/RECEIVE`) and the July NFT round-trips with
`9mpJ…SAd3` from `research.md`.

**Acceptance Scenarios**:

1. **Given** a `TRANSFER` of 1.1 USDC from the wallet to `9mpJ…`, **When**
   the mapper runs, **Then** `type` is `send`, `outputs` holds one USDC leg
   of `1100000` with `destination: 9mpJ…`, `inputs` is empty.
2. **Given** an NFT sent with a 0.001448 SOL royalty on the side, **When**
   the mapper runs, **Then** `outputs` holds the NFT leg only: the SOL side
   leg is under the side-leg floor (FR-007) and folds into the transaction.
3. **Given** a USDC receive, **Then** `type` is `receive`, `inputs` holds
   one USDC leg with `source` set, `outputs` is empty.

---

### User Story 3 - A swap or a stake shows both sides (Priority: P2)

An aggregator swap or a liquid stake shows what left and what arrived, as
one row with both signs.

**Acceptance Scenarios**:

1. **Given** a swap that spent 1.2 USDC and returned SOL, **When** the
   mapper runs, **Then** `outputs` holds the USDC leg, `inputs` the SOL leg,
   and the type is `interaction` (the provider's `SWAP`/`AGGREGATOR` hint
   keeps mapping to `interaction` as today).
2. **Given** a stake, **Then** the provider's `stake` type is kept and the
   legs still come from the net change.

---

### Edge Cases

- A provider payload without `accountData` (a cached first page from before
  this change, or a provider that stops sending it): the mapper derives the
  net change from the transfers instead (incoming minus outgoing per asset)
  and says so in `_delta.source` for tests; the public shape is identical.
- A failed transaction: balances did not move; legs are empty, `status` is
  `failed`, `type` follows the provider hint.
- An SPL Memo with nothing moved stays `memo`.
- Token-2022 and pNFT: the net change is read per mint whatever the
  program; NFT-ness comes from the provider's `tokenStandard` as today.
- Spam detection (`isSpamReceive`) reads `inputs` and `feePayer`; it keeps
  working because a spam airdrop is still a `receive` with fungible inputs.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Legs are built from the wallet's net balance change per
  asset: SOL from the sum of `accountData[].nativeBalanceChange` for the
  wallet's own account, excluding the fee when the wallet paid it (the fee
  keeps its own field); tokens from `accountData[].tokenBalanceChanges`
  summed per mint over every token account the wallet owns.
- **FR-002**: The Triton parser fills `tokenBalanceChanges` from the
  ledger's `preTokenBalances` / `postTokenBalances`, keyed by owner, in the
  same shape Helius emits (`userAccount`, `tokenAccount`, `mint`,
  `rawTokenAmount { tokenAmount, decimals }`), so both providers feed one
  reader.
- **FR-003**: One leg per asset: a negative net is one output, a positive
  net is one input. No leg for a zero net (a self-transfer, a hop through
  the wallet).
- **FR-004**: Direction, for a provider type of `TRANSFER` or `UNKNOWN`:
  outputs only → `send`; inputs only → `receive`; both → `interaction`;
  neither → `memo` when a note was written, `interaction` when the wallet
  paid the fee, `unknown` otherwise. `inferDirectionalType`'s `return SEND`
  fallback is removed.
- **FR-005**: Semantic provider types (`mint`, `burn`, `stake`, `loan`,
  `interaction`, `memo`) keep precedence over direction as today; their legs
  still come from the net change.
- **FR-006**: A transaction the wallet signed whose only change is SOL
  coming back (closed accounts, refunds) is `interaction` with an input
  leg, not `receive`: nobody sent it; the wallet reclaimed it.
- **FR-007**: A SOL leg that rides beside token legs is reported only when
  its absolute value is at least `NATIVE_SIDE_LEG_MIN_LAMPORTS`
  (0.005 SOL); below that it is rent, a royalty or a tip and folds into
  the transaction. A SOL leg that is the only asset moving is always
  reported. (Owner decision pending on the exact floor; 0.005 SOL is two
  associated-token-account rents.)
- **FR-008**: The counterparty of a leg comes from the provider transfers
  of that asset: for an output, the `toUserAccount` receiving the largest
  amount of that mint; for an input, the `fromUserAccount` sending the
  largest. Legs of an `interaction` carry no counterparty.
- **FR-009**: Amounts stay raw strings in atomic units; NFT legs stay
  `amount: '1', decimals: 0, isNft: true` with the same metadata enrichment.
- **FR-010**: The public payload shape does not change: `type`, `inputs`,
  `outputs`, `fee`, `memo`, `description`, `source`, `heliusType`,
  `instructions`, `feePayer`, `slot`, `blockTime`, `confirmationStatus`.
- **FR-011**: The bare-RPC path (`solana-transaction-resource.js`, both
  providers down) is out of scope and keeps its behaviour; it is noted in
  `plan.md` as the next lot.

### Key Entities

- **WalletDelta**: `{ native: string (signed lamports, fee excluded), tokens: Map<mint, { amount: string (signed raw), decimals: number }>, source: 'accountData' | 'transfers' }` — pure, computed in `src/resources/solana/wallet-delta.js`.
- **Leg**: the public `inputs[]` / `outputs[]` item, unchanged.

## Success Criteria _(mandatory)_

- **SC-001**: The three 2026-09-14 transactions on `7Q3H…as6n` read as one
  `interaction` row each with a single positive SOL input and no NFT leg;
  no row says "To burn…Qxgt".
- **SC-002**: The July MNDFLK round-trips still read as `send` / `receive`
  with one NFT leg each and the `9mpJ…` counterparty.
- **SC-003**: `npm run test:unit`, `npm run format:check` and
  `npm run lint:check` pass; the frontend's `packages/shared` transaction
  suites pass unchanged (no contract change).
- **SC-004**: The owner reproduces SC-001 on the device against the local
  backend.

## Assumptions

- `accountData` from Helius is post-minus-pre per account, fee included for
  the fee payer (verified on the real payload: `7Q3H…` shows
  `+3,597,268` while its transfers out sum to `2,187,197` plus a
  `24,895` fee and six `550,840` rents returned). Helius no longer
  documents the field (Enhanced Transactions is in maintenance mode); the
  ledger's `meta.preBalances/postBalances` is the primary source through
  the Triton parser, which is the production primary.
- The first-page history cache holds payloads in the old shape until its
  TTL; no invalidation is added.
