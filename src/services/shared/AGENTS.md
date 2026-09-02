# AGENTS.md instructions for `src/services/shared`

## Responsibility

- own services that have no blockchain affinity:
  - `coingecko-service` (market data, prices, history)
  - `dapp-service` (OpenGraph dApp metadata)
  - `geo-service` (caller IP geolocation via ip-api.com, backs `GET /ip`)
  - `network-capabilities-service` (per-stage feature gating)
  - `network-catalog-service` (public network list)
  - `scam-service` (Phantom Labs blocklist per chain)
  - `trustwallet-service` (Trustwallet asset registry)
- expose orchestration that several controllers / jobs reuse without going through a chain slice

## Rules

- Do not put chain-specific logic here; that belongs in `src/services/bitcoin`, `src/services/solana`, or `src/services/multichain`.
- Keep the public surface free of chain branching beyond what the underlying providers already require.
- If a helper grows chain affinity, move it into the matching chain slice.

## Testing

- Tests live in `src/services/shared/__tests__/`. Mock external providers and repositories, never hit the real network.
