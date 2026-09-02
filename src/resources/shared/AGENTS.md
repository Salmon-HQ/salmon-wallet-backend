# AGENTS.md instructions for `src/resources/shared`

## Responsibility

- shape payloads served by chain-agnostic endpoints (multichain balance,
  coingecko, network catalog)
- own cross-cutting include helpers (`resource-includes.js`) used by
  per-chain resources for `logo` / `blacklisted` side-loads

## Rules

- Do not put chain-specific response shapes here; those belong in
  `src/resources/<chain>/`.
- `resource-includes.js` is the canonical place for `includeLogo` /
  `includeBlacklisted`. Per-chain resources import these via
  `../shared/resource-includes` rather than re-implementing.
- Keep response contract shaping here even when the underlying service
  is in `services/shared/`. The resource is the public-facing contract;
  the service is internal.

## Testing

- Tests for moved resources live alongside in `__tests__/`.
- Cross-chain tests that exercise multiple slices live higher up
  (`src/__tests__/`).
