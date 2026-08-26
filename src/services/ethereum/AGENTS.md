# AGENTS.md instructions for `src/services/ethereum`

## Status

Skeleton. No Ethereum services yet.

## Responsibility (when implemented)

- own Ethereum business logic and provider routing
- expose a balance provider conforming to the
  `BalanceProvider` interface in
  `src/services/multichain/balance-providers/balance-provider.js`
  when ready (typical name: `ethereum-balance-provider.js`)
- delegate provider HTTP construction to a dedicated client under
  `src/infrastructure/` (e.g. `alchemy-client.js`, `infura-client.js`)
  rather than wiring axios directly here

## Rules

- Keep Ethereum services isolated from Bitcoin and Solana modules.
- If a helper is genuinely cross-chain (no `blockchain` branching),
  consider `src/services/shared` instead.
- The default Blockdaemon Universal balance provider already works for
  Ethereum if you ever want to enable balance reads quickly without a
  dedicated provider — register the chain in
  `src/services/multichain/balance-providers/index.js#PROVIDERS_BY_CHAIN`
  only when you have a richer override.

## Testing

- Add service tests once concrete files exist.
