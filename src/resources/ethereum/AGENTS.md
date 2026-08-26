# AGENTS.md instructions for `src/resources/ethereum`

## Status

Skeleton. No Ethereum resources yet.

## Responsibility (when implemented)

- shape Ethereum response payloads consumed by the FE
- mirror the canonical-shape conventions used by
  `src/resources/bitcoin` and `src/resources/solana`

## Rules

- Keep Ethereum payload shaping isolated from Bitcoin and Solana modules.
- Cross-chain shapes (e.g. account balance) live in
  `src/resources/shared`.

## Testing

- Add resource tests once concrete files exist.
