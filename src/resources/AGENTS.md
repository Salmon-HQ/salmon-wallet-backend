# AGENTS.md instructions for `src/resources`

## Responsibility

- shape public API payloads
- normalize response structures
- isolate output mapping from service logic

## Slices

Mirrors the `src/services/` layout:

- `bitcoin/` — Bitcoin transaction + UTXO shapes.
- `solana/` — Solana account, FT, NFT, swap, transaction shapes
  (heaviest slice; consumes both `helius-transaction-resource.js` and
  the Triton-parsed canonical shape).
- `shared/` — chain-agnostic resources backing `services/shared/`:
  `account-balance-resource`, `network-resource`,
  `resource-includes` (cross-cutting `includeLogo` /
  `includeBlacklisted` helpers).
- `ethereum/` — skeleton (no shapes yet).

When a payload spans multiple chains (e.g. multichain balance),
shape it under `shared/`.

## Rules

- Put response contract shaping here.
- Avoid business decisions here unless they are inherent to serialization.
- Keep provider payload details out of controllers when a resource can normalize them.

## Testing

- Add or update resource tests when public response shape changes.
