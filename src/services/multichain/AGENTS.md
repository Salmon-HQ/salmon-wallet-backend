# AGENTS.md instructions for `src/services/multichain`

## Responsibility

- own service logic for endpoints that dispatch across more than one blockchain
- resolve the active chain from `locals.network.blockchain` and route the call accordingly
- delegate provider-specific work to chain slices (`src/services/bitcoin`, `src/services/solana`) when needed

## Rules

- Keep the public service shape chain-agnostic; never hardcode a single chain inside this folder.
- If a service ends up handling only one chain, move it back to that chain's slice.
- Do not put cross-domain helpers here that have no chain dispatching — use `src/services/shared` instead.

## Testing

- Cover dispatch behavior with tests that exercise more than one `network.blockchain` value where practical.
