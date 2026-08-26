# AGENTS.md instructions for `src/services/multichain/balance-providers`

## Responsibility

- expose the `BalanceProvider` plug-point used by
  `src/services/multichain/account-service.js` to dispatch
  `getBalance` per blockchain
- own the default Blockdaemon Universal implementation
- own the registry that maps `locals.network.blockchain` to the
  resolved provider

## Rules

- Keep `index.js` thin — it is a registry, not orchestration logic.
- A chain-specific provider lives in that chain's slice
  (`src/services/<chain>/`) and is wired in here. Do not let
  per-chain HTTP construction leak into this folder.
- The default (`blockdaemon-balance-provider.js`) MUST keep working
  for any chain Blockdaemon Universal supports.
- Do not branch on `blockchain` inside the default provider — chain
  affinity belongs in chain-specific overrides.

## Testing

- Cover the resolver with tests that exercise registered + default
  paths.
- Provider implementations live next to their owner slice and are
  tested there; this folder only tests dispatch.
