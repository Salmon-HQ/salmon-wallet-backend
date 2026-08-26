# AGENTS.md instructions for `src/routes/bitcoin`

## Responsibility

- expose Bitcoin HTTP surface
- keep Bitcoin path wiring isolated from Solana routing

## Rules

- Keep Bitcoin route changes in this folder.
- Delegate behavior to Bitcoin controllers.
- Do not grow Bitcoin route files into service-like code.
- `routes/bitcoin/` exposes the Bitcoin account surface (`/:address/transactions`, `/:address/utxo`, `POST /:address/transactions`). Cross-chain balance lives in `routes/multichain/`.

## Testing

- Update or add controller-level verification when Bitcoin route behavior changes.
