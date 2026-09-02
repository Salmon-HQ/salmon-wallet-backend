# Contracts touched: Replace the archived SPL Token Registry

## Public — `solana-fungible-token-catalog` (AGENTS.md)

`GET /v1/:network/ft/verified` and `GET /v1/:network/ft/search?q=` —
**unchanged**. Neither reaches the modified branch; `solana-ft-batch-resource`
is untouched. Shipped shape stays:

```json
{
  "chainId": 101,
  "address": "…",
  "symbol": "…",
  "name": "…",
  "decimals": 6,
  "logo": "…|null",
  "tags": [],
  "coingeckoId": "…|null"
}
```

Verification: existing controller/resource specs pass unmodified.

## Public — transaction history / balance on `solana-devnet`, `solana-testnet`

Payloads are byte-identical for the same upstream data: `list()` returns the
same entry objects from the same snapshot. Failure mode changes only in
_source_ (CDN unreachable instead of the package's own fetch failing), not in
shape: standard envelope `{ error: 'server_error', error_description }`, 500.

## Internal — `cdn-token-list-service`

New exports, additive:

```js
/** @type {{ mainnet: 101, testnet: 102, devnet: 103 }} */
CLUSTER_CHAIN_IDS;

/**
 * @param {'mainnet'|'testnet'|'devnet'} environment
 * @returns {Promise<Object[]>} raw CDN entries for that cluster (not normalised)
 * @throws on unknown environment (before any request) and on fetch failure
 */
getClusterTokens(environment);
```

Existing `getVerifiedTokens()` and `CDN_TOKEN_LIST_URL` unchanged.

## Internal — `solana-ft-service.getTokenList(locals)`

Same signature and return shape. Devnet/testnet source switches from
`@solana/spl-token-registry` to `cdnTokenListService.getClusterTokens`.
