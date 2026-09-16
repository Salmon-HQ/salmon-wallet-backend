# Implementation Plan — 016 activity wallet delta

## Layers touched

1. **Parser** (`src/services/solana/parser/index.js`): `collectAccountData`
   also emits `tokenBalanceChanges` from `preTokenBalances` /
   `postTokenBalances`, Helius shape, one entry per token account whose
   amount moved, attached to that token account's `accountData` row with
   `userAccount` = owner. Accounts with a token change but no lamport change
   are kept.
2. **Resource, new pure module** `src/resources/solana/wallet-delta.js`:
   `computeWalletDelta(transaction, address)` → `{ native, tokens, source }`.
   Reads `accountData` when present; falls back to transfers otherwise.
3. **Resource** `helius-transaction-resource.js`: legs and direction from
   the delta (`buildLegs`, `resolveType`), counterparties from transfers,
   NFT marking and metadata enrichment unchanged. `inferDirectionalType`
   removed; `mapTransactionType` keeps the provider-type table.
4. **Service**: unchanged (spam filter still reads `inputs`).
5. **Docs**: `docs/ARCHITECTURE.md` (Solana resources: what a leg is now),
   `src/resources/solana/AGENTS.md`, `CHANGELOG.md` if present.

## Out of scope (next lot)

- The bare-RPC mapper `solana-transaction-resource.js` (both providers
  down) — same defect class, separate change.
- A Salmon-side label for known service vaults (`burn68…`) — product.

## Tests

- `wallet-delta.spec.js`: native with/without fee payer, token sums across
  several token accounts of one owner, ignores other owners, fallback from
  transfers, zero nets dropped.
- Parser: `accountData.tokenBalanceChanges` from pre/post token balances.
- Resource: the three real fixtures (minimal, sanitised to the fields the
  mapper reads), the USDC send/receive, the NFT send with royalty (side leg
  folded), the swap (both legs, `interaction`), fee-only (`interaction`,
  no legs), self-transfer (no leg), provider without `accountData`.
- Existing suites updated where the old rule was pinned
  (`TRANSFER with self-loop → SEND fallback`).
