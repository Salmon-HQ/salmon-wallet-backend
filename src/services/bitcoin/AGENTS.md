# AGENTS.md instructions for `src/services/bitcoin`

## Responsibility

- own Bitcoin-specific business logic: transactions and UTXO walking
- read chain data through `src/infrastructure/esplora-client.js`
  (mempool.space, then blockstream.info) rather than wiring axios
  directly; `esplora-mappers.js` turns Esplora payloads into the item
  shapes the resources read
- own `bitcoin-balance-provider.js` (registered in
  `src/services/multichain/balance-providers`)
- keep first-page transaction-history caching on the
  `bitcoin-transactions` namespace via
  `src/infrastructure/cache/transaction-history-cache.js`

## Rules

- Keep Bitcoin services isolated from Solana / Ethereum modules.
- Cross-chain dispatch (e.g. the balance route) lives in
  `src/services/multichain`.
- Cross-domain helpers with no chain affinity live in
  `src/services/shared`.
- If a helper is genuinely Bitcoin-only, keep it close to this slice
  rather than promoting it to `shared/`.
- This slice is read-only. The wallet signs and broadcasts Bitcoin
  transactions itself, directly to a public broadcast endpoint; the
  backend never receives a signed transaction. Do not add a relay.

## Hotspots

- `bitcoin-transaction-service.js` owns the first-page tx history
  cache key (`bitcoin-transactions`). Renaming the key or changing
  the partition causes cache misses for every Bitcoin user — change
  with intent.

## Testing

- Unit-test each service in `__tests__/`. Mock `esplora-client`;
  never hit the real network.
- Cross-cutting integration tests live under `src/__tests__/`.
