# AGENTS.md instructions for `src/resources/bitcoin`

## Responsibility

- shape Bitcoin transaction and UTXO response payloads consumed by
  the FE
- mirror the canonical-shape conventions used by
  `src/resources/solana`

## Rules

- Keep Bitcoin payload shaping isolated from Solana / Ethereum
  modules.
- Cross-chain shapes (e.g. account balance) live in
  `src/resources/shared`.
- The 9-bucket transaction type derivation is a documented contract.
  Do not change field names without treating it as a contract change.

## Testing

- Resource-level snapshots and unit tests live in `__tests__/`.
