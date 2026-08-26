# AGENTS.md instructions for `src/services/solana`

## Scope

These rules apply to Solana service code only.

## Responsibilities

- `solana-transaction-service.js`
  - orchestrates transaction lookup/history
  - delegates the enriched-tx path to the provider resolver (`./providers`)
  - falls back to bare RPC when neither provider is available or the resolver throws
- `solana-rpc-enrichment.js`
  - preloads the lookups the bare-RPC transaction resource reads (token list, token accounts, per-tx NFT metadata) onto `locals`, so `src/resources/solana/solana-transaction-resource.js` stays a pure mapper with no network I/O
- `providers/`
  - resolver wires Triton One as primary + Helius as rate-limited fallback for tx enrichment
  - DAS surface (NFT metadata) is Triton primary with a rate-limited Helius fallback, same as tx enrichment; goes straight to Helius when Triton is not configured for the env
  - canonical provider abstraction lives in `solana-data-provider.js`
- `parser/`
  - local Triton parser pipeline that produces the same enriched-tx shape as Helius Enhanced API, so the resource decorator stays provider-agnostic
  - per-program parsers under `parser/parsers/`: `system`, `spl-token`, `metaplex`, `bubblegum`, `jupiter`, `stake`, `staking`, `lending`, `dex`
- `helius-transaction-service.js`
  - Helius API wrapper used by the Helius provider
- `transaction-serialization.js`
  - common serialization helpers used by transaction flows
- `solana-ft-service.js`
  - FT-oriented read flows and token fetch orchestration
- `jupiter-token-service.js`
  - Jupiter token catalog/search wrapper
- `solana-ft-swap-service.js`
  - Jupiter swap order/execute flow
- `solana-nft-service.js`
  - NFT read flows
- `burn-service.js`
  - burn routing and transaction creation for supported asset types
- `solana-address-service.js`
  - address validation and normalization helpers
- `jupiter-service.js`
  - Jupiter HTTP client used by token and swap services
- `address-lookup-table-service.js`
  - resolves Solana address lookup tables for transaction parsing
- `solana-nft-burn-errors.js`
  - typed error mapping for NFT burn flows

## Local rules

- Keep provider selection and fallback policy in services, not in controllers.
- Keep public payload shaping in `src/resources/solana` unless a helper is clearly internal to the service layer.
- Do not leak raw Helius or Jupiter payloads upward if the rest of the app expects normalized data.
- When adding a helper, prefer extracting a focused local helper over growing one large service file further.

## Contract-sensitive areas

- Transaction history/detail must keep frontend-compatible shape.
- Burn flows are sensitive to asset type routing. Verify standard NFT, programmable NFT, and compressed NFT paths as applicable.
- Swap flows must preserve quote/order/execute expectations used by frontend clients.

## Testing rules

- Put tests in `src/services/solana/__tests__` unless another layer is the real contract under change.
- Add or update tests for new Solana behavior at the narrowest useful scope.
- Before refactoring transaction, burn, swap, FT, or NFT flows, capture a baseline with targeted tests when practical.
- After changes, rerun the touched backend tests and the most relevant frontend tests in `../salmon-wallet-frontend` when contract-sensitive.
