---
name: solana-rpc-context
description: RPC, provider, and caching architecture of this multichain (Solana-first) API — Triton/Helius, Jupiter over REST, Metaplex/umi, Redis and in-memory cache layers. ALWAYS use before touching Solana services, price/swap/NFT endpoints, RPC configuration, or when debugging rate limits, stale prices, or slow responses.
---

# Solana / RPC Context — salmon-api

## RPC providers — order of preference

- `src/constants/networks.js` → `solanaNodeUrl(env)`: prefers **Triton** when configured, falls back to **Helius**. Do not hardcode RPC URLs in services — always resolve through this function.
- `src/infrastructure/triton-client.js`: token as a path segment (`.rpcpool.com/<token>`); env `TRITON_RPC_URL`, `TRITON_RPC_URL_DEVNET`, `TRITON_API_TOKEN`; throws `TRITON_NOT_CONFIGURED` to trigger the fallback.
- `src/infrastructure/helius-client.js`: RPC + Enhanced Transactions API; `DEFAULT_COMMITMENT='confirmed'`; lazy key read from `HELIUS_API_KEY`.
- `src/infrastructure/blockdaemon-client.js`: multichain balances (Universal API), not a Solana RPC.
- Service-level providers: `src/services/solana/providers/{triton,helius}-provider.js` (create `@solana/web3.js` `Connection`s).

## Jupiter — REST, not the SDK

`@jup-ag/api` is in package.json but **unused** (0 imports). Jupiter is consumed over REST with axios against `JUPITER_PRICE_URL`/`JUPITER_SWAP_URL`:

- `src/services/solana/jupiter-service.js` — Price v3 with rate limiting + Redis cache.
- `src/infrastructure/rate-limiting/jupiter-rate-limiter.js` — respect it; Jupiter bans on bursts.
- Swap: `solana-ft-swap-service.js`; Jupiter transaction parser in `src/services/solana/parser/parsers/jupiter.js`.

## Cache layers — pick the right one

| Layer                          | Where                                                   | TTL       | Purpose                                                     |
| ------------------------------ | ------------------------------------------------------- | --------- | ----------------------------------------------------------- |
| In-memory + request coalescing | `src/infrastructure/cache/transaction-history-cache.js` | 15s       | tx history (first page only; coalesces concurrent requests) |
| Redis                          | `src/infrastructure/cache/price-cache.js`               | 5min      | Jupiter quotes (`getQuoteWithCache`)                        |
| Redis                          | `src/infrastructure/cache/token-list-cache.js`          | —         | token lists                                                 |
| HTTP `Cache-Control`           | `cacheControl(...)` middleware per route                | per route | CDN/client-cacheable responses                              |

Redis backend via `src/repositories/helper.js`. If you add a chain-data endpoint, decide caching explicitly — an uncached endpoint against a public RPC is a rate-limit incident waiting to happen.

## Metaplex (NFT/burn)

`src/services/solana/burn-service.js` concentrates the umi stack: `umi` + `umi-bundle-defaults`, `mpl-token-metadata`, `mpl-bubblegum` (`burnV2`, `getAssetWithProof` for compressed assets), `dasApi`. web3js adapters in `address-lookup-table-service.js` and `transaction-serialization.js`.

For Metaplex/NFT work (burn, transfer, Bubblegum, DAS), agents can install the official Metaplex skill: `npx skills add metaplex-foundation/skill`.

## Route map

Entry `src/index.js` (Express → serverless-http; CORS: `*.salmonwallet.io` + localhost). Dynamic per-chain mounting at `/v1/<chain>-<env>`: `routes/solana/index.js` (`/ft` verified/search/swap, `/account`, `/nft` incl. burn), `routes/bitcoin/`, `routes/ethereum/`. Also: coingecko market data (`/v1/exchange-rates`, `/v1/chart/:coinId`, `/v1/coin/:coinId`), dapp metadata, internal allowlist (auth `allowlistAdmin`).

## Security

Any change to swap/send/burn flows moves user value, so it needs a security
review pass: amounts in base units with BigInt/BN, mint/address validation,
and never RPC metadata as the source of truth for token identity. If your
environment provides a web3 security review skill or agent, run it; otherwise
apply that checklist manually.
