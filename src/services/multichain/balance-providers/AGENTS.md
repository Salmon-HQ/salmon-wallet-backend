# AGENTS.md instructions for `src/services/multichain/balance-providers`

## Responsibility

- expose the `BalanceProvider` plug-point used by
  `src/services/multichain/account-service.js` to dispatch
  `getBalance` per blockchain
- own the registry that maps `locals.network.blockchain` to the
  resolved provider

## Rules

- Keep `index.js` thin — it is a registry, not orchestration logic.
- A chain's provider lives in that chain's slice
  (`src/services/<chain>/`: `bitcoin-balance-provider.js` on Esplora,
  `solana-balance-provider.js` on the Solana RPC) and is wired in here. Do
  not let per-chain HTTP construction leak into this folder.
- There is no default provider: a chain the balance route allows but this
  registry does not list throws, so a missing wiring fails loudly.

## Testing

- Cover the resolver with tests that exercise every registered chain and
  the unregistered case.
- Provider implementations live next to their owner slice and are
  tested there; this folder only tests dispatch.
