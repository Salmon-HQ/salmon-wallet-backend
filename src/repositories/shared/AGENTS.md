# AGENTS.md instructions for `src/repositories/shared`

## Responsibility

- own persistence for chain-agnostic services in
  `src/services/shared/`: bridge, coingecko, scam, trustwallet
- wrap Redis cache (via `../helper.js`) calls behind a service-shaped
  API

## Rules

- Keep business orchestration out of repositories — services in
  `src/services/shared/` own that.
- Do not reach into chain-specific data; that lives in
  `src/repositories/solana/` (and future chain slices).
- Cache TTLs / cache keys are part of each repository's contract;
  changing them requires confirming the matching service still
  behaves correctly under both cache hit and miss.

## Testing

- Add or update repository tests when data access behavior or source
  assumptions change.
- The dependent service tests live in `src/services/shared/__tests__/`
  and mock these repositories — keep mock surfaces aligned with the
  exported function signatures.
