# AGENTS.md instructions for `src/resources/solana`

## Responsibility

- shape Solana account, FT, NFT, swap, and transaction payloads
- normalize enriched-tx data from both providers (Helius Enhanced API and the local Triton parser) plus RPC-derived transaction data into public API contracts
- `helius-transaction-resource.js` is the shared canonical mapper for both providers — its name is back-compat only; both Helius and Triton outputs flow through it.

## Rules

- Keep Solana response contracts centralized here.
- Avoid moving orchestration or provider selection into this layer.
- No network I/O in resources. The bare-RPC transaction mapper reads its
  lookups (`locals.tokens`, `locals.tokenAccounts`, `locals.rpcNftBySignature`)
  preloaded by `src/services/solana/solana-rpc-enrichment.js`.
- Transaction resources must preserve client-facing field names and structures.

## Testing

- Update resource tests whenever Solana transaction or asset payload shape changes.
