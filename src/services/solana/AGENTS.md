# AGENTS.md instructions for `src/services/solana`

## Scope

These rules apply to Solana service code only.

## Responsibilities

- `solana-transaction-service.js`
  - orchestrates transaction lookup/history
  - delegates the enriched-tx path to the provider resolver (`./providers`)
  - falls back to bare RPC when neither provider is available or the resolver throws
- `solana-rpc-enrichment.js`
  - preloads the lookups the bare-RPC transaction resource reads (token list, per-tx NFT metadata) onto `locals`, so `src/resources/solana/solana-transaction-resource.js` stays a pure mapper with no network I/O
- `providers/`
  - resolver wires Triton One as primary + Helius as rate-limited fallback for tx enrichment
  - DAS surface (NFT metadata) is Triton primary with a rate-limited Helius fallback, same as tx enrichment; goes straight to Helius when Triton is not configured for the env
  - canonical provider abstraction lives in `solana-data-provider.js`
- `parser/`
  - local Triton parser pipeline that produces the same enriched-tx shape as Helius Enhanced API, so the resource decorator stays provider-agnostic
  - per-program parsers under `parser/parsers/`: `system`, `spl-token`, `metaplex`, `bubblegum`, `aggregator`, `stake`, `staking`, `lending`, `dex`
- `helius-transaction-service.js`
  - Helius API wrapper used by the Helius provider
- `transaction-serialization.js`
  - common serialization helpers used by transaction flows
- `solana-ft-service.js`
  - FT-oriented read flows and token fetch orchestration
- `token-catalog-service.js`
  - CoinGecko Solana token list + coin ids → verified catalog, local search (24 h snapshot)
- `token-metadata-service.js`
  - Triton DAS `getAssetBatch` → per-mint metadata, token program
- `powerups/` — `registry.js` (Salmon-maintained Powerup entries: tier, networks, contributor, `programIds` / `endpoints`, optional adapter), `powerup-catalog-service.js` (the `powerups` list `/v1/networks` publishes per network), `powerup-build-service.js` (resolve via the catalog predicate → adapter validate → adapter build → declared lookup tables → shared compile → declared-program check on the COMPILED message → simulation check; `salmonFee` forced null), `unsigned-transaction-builder.js` (the shared compile step: ALTs, blockhash, priority fee, compute-unit limit, simulation), `powerup-errors.js`. Adapters never read `req`; they get validated params + `{ locals, connection }` and every upstream call goes through `providerCall` under the entry's `providerProfile` row.
- `solana-nft-service.js`
  - NFT read flows
- `burn-service.js`
  - burn routing and transaction creation for supported asset types
- `solana-address-service.js`
  - address validation and normalization helpers
- `address-lookup-table-service.js`
  - resolves Solana address lookup tables for transaction parsing
- `solana-nft-burn-errors.js`
  - typed error mapping for NFT burn flows

## Local rules

- Keep provider selection and fallback policy in services, not in controllers.
- Keep public payload shaping in `src/resources/solana` unless a helper is clearly internal to the service layer.
- Do not leak raw Helius, DAS or CoinGecko payloads upward if the rest of the app expects normalized data.
- When adding a helper, prefer extracting a focused local helper over growing one large service file further.

## Contract-sensitive areas

- Transaction history/detail must keep frontend-compatible shape.
- Burn flows are sensitive to asset type routing. Verify standard NFT, programmable NFT, and compressed NFT paths as applicable.
- Every Powerup build is instructions → unsigned transaction only (root `AGENTS.md` "Signing boundary"); never accept signed bytes or broadcast.
- A Powerup build must refuse a compiled message whose top-level instructions (lookup tables resolved) invoke a program outside the registry entry's `programIds` + ComputeBudget (502 `provider_program_mismatch`) — that check is the only thing standing between an adapter bug and a transaction the wallet signs. A declared program is trusted with everything it can CPI into.

## Testing rules

- Put tests in `src/services/solana/__tests__` unless another layer is the real contract under change.
- Add or update tests for new Solana behavior at the narrowest useful scope.
- Before refactoring transaction, burn, Powerup build, FT, or NFT flows, capture a baseline with targeted tests when practical.
- After changes, rerun the touched backend tests and the most relevant frontend tests in `../salmon-wallet-frontend` when contract-sensitive.
