# AGENTS.md instructions for `src/resources/solana`

## Responsibility

- shape Solana account, FT, NFT, Powerup build, and transaction payloads
- normalize enriched-tx data (the local Triton parser, which emits the Helius Enhanced API shape) plus RPC-derived transaction data into public API contracts
- `helius-transaction-resource.js` is the canonical enriched-tx mapper — its name is back-compat only; the parser's output flows through it.
- Legs are the wallet's net balance change per asset, computed in `wallet-delta.js` from `accountData` (the parser fills it from the ledger). The provider's transfers name the counterparty and nothing else; never build a leg from a transfer list again — that is how a self-transfer became a send and five fees became five rows (spec 016).

## Rules

- Keep Solana response contracts centralized here.
- Avoid moving orchestration or provider selection into this layer.
- No network I/O in resources. The bare-RPC transaction mapper reads its
  lookups (`locals.tokens`, `locals.tokenAccounts`, `locals.rpcNftBySignature`)
  preloaded by `src/services/solana/solana-rpc-enrichment.js`.
- Transaction resources must preserve client-facing field names and structures.

## Testing

- Update resource tests whenever Solana transaction or asset payload shape changes.
