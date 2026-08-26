# AGENTS.md instructions for `src/services/multichain/price-enrichers`

## Responsibility

- attach USD pricing to balance items returned by per-chain `BalanceProvider`s
- per-chain plug-points wired through a single resolver in `index.js`

## Rules

- Each enricher MUST implement `enrich(items, locals)` and return the same array shape it received. When a quote is available, items get internal markers `_price`, `_usdBalance`, `_priceChange24h`; items without a quote pass through untouched.
- The shared response decorator (`src/resources/shared/account-balance-resource.js`) forwards those markers as `price`, `usdBalance`, `priceChange24h` in the public payload. Do not surface the markers under any other field name.
- Enrichers MUST NOT throw on a cold cache or upstream failure — fall back to passthrough so the wallet keeps working without prices.
- Source the upstream quote from the established service for the chain (Solana → `solana/jupiter-service`, Bitcoin → `repositories/shared/coingecko-repository`). Do not introduce new HTTP clients here.
- New chains: add a file (e.g. `ethereum-price-enricher.js`) and register it in `index.js#ENRICHERS_BY_CHAIN`. Use the `BLOCKCHAINS` constant for the key.

## Testing

- Add or update enricher tests under `__tests__/` when changing pricing behavior. Mock the upstream quote source rather than the network.
