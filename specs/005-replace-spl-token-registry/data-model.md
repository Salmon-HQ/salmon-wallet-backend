# Data Model: Replace the archived SPL Token Registry

No persistence changes. Two in-memory shapes, both pre-existing.

## Token metadata entry (raw CDN / registry shape)

Element of `tokens[]` in `solana.tokenlist.json`; identical to what
`@solana/spl-token-registry`'s `getList()` returned.

| Field                    | Type      | Notes                                                         |
| ------------------------ | --------- | ------------------------------------------------------------- |
| `chainId`                | number    | `101` mainnet-beta, `102` testnet, `103` devnet               |
| `address`                | string    | mint address — lookup key for `list()` readers                |
| `symbol`                 | string    |                                                               |
| `name`                   | string    | `list()` drops entries without it                             |
| `decimals`               | number    | `list()`/`filterFungibleTokens` keep `decimals > 0`           |
| `logoURI`                | string?   | read by resources as `logoURI`; never normalised on this path |
| `tags`                   | string[]? |                                                               |
| `extensions.coingeckoId` | string?   | only `extensions` field any consumer reads                    |

Validation: `getClusterTokens` keeps entries where `entry && entry.chainId === CLUSTER_CHAIN_IDS[environment]`. No further filtering — `list()` applies its own `name` filter as today.

## Cluster token list (in-memory cache entry)

Unchanged. `tokenListCache: Map<environment, { tokens: Entry[], expiresAt: number }>`,
TTL 1 h; `pendingTokenLoads: Map<environment, Promise<Entry[]>>` for inflight dedup.
Keyed by `locals.network.environment` (`'mainnet' | 'testnet' | 'devnet'`).

State transitions:

```
miss ──load──▶ pending ──resolve──▶ cached (1 h) ──expire──▶ miss
                 │
                 └──reject──▶ miss   (nothing written; error propagates)
```

## Constant

`CLUSTER_CHAIN_IDS = { mainnet: 101, testnet: 102, devnet: 103 }` — exported
from `cdn-token-list-service` so tests pin the mapping.
