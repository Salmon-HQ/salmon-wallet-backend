# AGENTS.md instructions for `src/controllers/solana`

## Responsibility

- expose Solana account, FT, and NFT HTTP behavior
- translate request params/query/body into Solana service calls

## Rules

- Keep Solana controllers focused on HTTP concerns.
- Delegate transaction, token, NFT, burn, and swap behavior to `src/services/solana`. The provider abstraction (Triton primary + Helius fallback) lives under `src/services/solana/providers/`, and the local enriched-tx parser pipeline lives under `src/services/solana/parser/`.
- Keep public payload shaping aligned with `src/resources/solana`.
- The NFT controller exposes only `list`, `burnTransaction`, and `transferTransaction`.

## Testing

- Update controller tests when Solana request parsing or response contracts change.
