# AGENTS.md instructions for `src/routes/ethereum`

## Status

Skeleton. The Ethereum slice does not expose any HTTP surface yet. The
empty `index.js` exists so the chain-mount loop in `src/index.js` can
require it without crashing.

## Responsibility (when implemented)

- expose Ethereum HTTP surface
- keep Ethereum path wiring isolated from Bitcoin and Solana

## Rules

- Keep Ethereum route changes in this folder.
- Delegate behavior to controllers under `src/controllers/ethereum`.
- Cross-chain endpoints (e.g. account balance) live under
  `src/routes/multichain`. To expose the multichain balance endpoint
  for Ethereum, add `ETHEREUM` to the `BALANCE_CHAINS` array in
  `src/routes/multichain/account-router.js`. Without that step the
  endpoint silently 404s on any `/v1/ethereum-*/account/:address/balance`
  request even after Ethereum is in the chain-mount loop.
- Public path layout (`/v1/<networkId>/...`) is part of the API
  contract and should match the patterns used by `routes/bitcoin` and
  `routes/solana`.

## Testing

- Add or update router tests when path wiring changes.
