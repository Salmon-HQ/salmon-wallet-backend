# AGENTS.md instructions for `src/constants`

## Responsibility

- shared static data shapes (network catalog, blockchain enum,
  transaction-type enum, Solana program IDs)

## Current contents

- `blockchains.js` — the `BITCOIN` / `SOLANA` / `ETHEREUM` literals plus
  the `BLOCKCHAINS` array that drives the chain-mount loop in
  `src/index.js`. Every entry in `BLOCKCHAINS` MUST have a matching
  `src/routes/<chain>/index.js`. Asserted by
  `__tests__/blockchains.spec.js`.
- `networks.js` — public network catalog (id, blockchain, environment,
  RPC config, explorer URL, icon). Consumed by `multinetwork`,
  `network-catalog-service`, and the network resource.
- `transaction-types.js` — the canonical 9-bucket type enum.
- `solana-constants.js`, `solana-program-ids.js` — Solana-specific data
  shared between services and resources. Kept here (rather than under
  `src/services/solana/`) because both layers consume them and a
  cross-layer require would otherwise leak.

## Rules

- This folder is data, not behavior. Do not put functions with
  branching logic here.
- Adding a new chain: add the literal + push it into `BLOCKCHAINS`.
  Then create `src/routes/<chain>/index.js` (even empty) so the boot
  loop succeeds. The constants test enforces that pairing.
- Adding a new network: append to `networks.js`. Activation in the FE
  is a separate concern and lives in `src/network-capabilities/`.

## Testing

- `__tests__/blockchains.spec.js` enforces the
  `BLOCKCHAINS` -> `routes/<chain>/index.js` invariant. Add similar
  asserts when introducing other "code-must-exist-when-listed"
  constants.
