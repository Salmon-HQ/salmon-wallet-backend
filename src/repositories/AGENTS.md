# AGENTS.md instructions for `src/repositories`

## Responsibility

- access data sources
- wrap reads and writes against storage or provider-specific data layers

## Slices

Mirrors the `src/services/` layout:

- `shared/` — chain-agnostic repositories that back services in
  `src/services/shared/`: `bridge`, `coingecko`, `scam`, `trustwallet`.
- `solana/` — Solana-specific repositories.
- `data-source.js`, `helper.js`, `index.js` at the root are shared
  infrastructure consumed by every slice. `helper.js` is a re-export
  facade over the cache primitives in
  `src/infrastructure/cache/cache-helper.js`.

Add a new chain-specific repository under `src/repositories/<chain>/`
when its service slice grows persistence concerns.

## Rules

- Keep business orchestration out of repositories.
- Use repositories for data access concerns, not HTTP routing or response shaping.
- If logic is purely technical and reusable beyond one repository, consider `src/infrastructure`.

## Testing

- Update repository tests when data access behavior or source assumptions change.
