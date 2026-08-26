# AGENTS.md instructions for `src/routes/multichain`

## Responsibility

- expose HTTP paths that span more than one blockchain (e.g. `GET /v1/:networkId/account/:address/balance`, served for `bitcoin-mainnet`, `solana-mainnet`, ... according to the route's allowlist)
- compose multichain routers and apply the `multinetwork` middleware that gates per-blockchain access

## Rules

- Keep route changes for cross-chain endpoints in this folder.
- Delegate behavior to controllers under `src/controllers/multichain`.
- Public path layout (`/v1/<networkId>/...`) is part of the API contract — do not change it without treating it as a contract change.

## Testing

- Add or update router tests when path wiring or supported-blockchain lists change.
