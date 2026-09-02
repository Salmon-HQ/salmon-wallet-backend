# Implementation Plan: Solana balance RPC fallback

**Branch**: `007-solana-balance-rpc-fallback` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

## Summary

Add `src/services/solana/solana-rpc-balance-provider.js` (a `BalanceProvider`
backed by `locals.network.config.nodeUrl`) and have
`solana-balance-provider.getBalance` fall back to it when the Blockdaemon
call fails with a transport error or 5xx. Enrichment, filters and the
resource are untouched because the fallback emits Blockdaemon-shaped items.

## Technical Context

**Language/Version**: Node 20 CJS · **Dependencies**: `@solana/web3.js` `Connection` (existing), `@solana/spl-token` program ids (existing; feature 006 moves them to local constants) · **Testing**: Jest 30, `jest.mock('@solana/web3.js', () => ({ Connection: jest.fn() }))` pattern already used in `helius-provider.spec.js` · **Constraints**: API Gateway 29 s hard cap; Lambda `api` is 60 s (untouched).

## Constitution Check (AGENTS.md)

| Gate                                                     | Status                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Chain-specific provider lives in the chain slice         | PASS — new file under `src/services/solana`; `balance-providers/` untouched                    |
| Fallback policy belongs in services                      | PASS — in `solana-balance-provider`                                                            |
| Never 200 with degraded data                             | PASS — 4xx propagate; RPC failure propagates; no empty list                                    |
| Bare-RPC path must remain functional                     | PASS — this feature exercises it                                                               |
| Public contract unchanged (`multichain-account-balance`) | PASS — same item shape into the same resource; AGENTS.md contract bullet gains a fallback note |
| Tests at nearest layer                                   | PASS — provider unit spec + fallback cases in `solana-balance-provider.spec.js`                |

## Design

### `solana-rpc-balance-provider.js`

```js
getBalance(address, _tokens, locals)
  connection = new Connection(locals.network.config.nodeUrl, 'confirmed')
  [lamports, classic, token2022] = Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
  ])
  → [ nativeItem(lamports), ...aggregateByMint(accounts).map(tokenItem) ]
```

Item shapes (match `solana-balance-provider.spec.js` fixtures):

- native: `{ owner, blockchain: 'solana', confirmed_balance: String(lamports), currency: { symbol: 'SOL', name: 'Solana', decimals: 9, type: 'native', asset_path: 'solana/native/sol' } }`
- token: `{ owner, blockchain: 'solana', confirmed_balance: <sum of amounts as string>, currency: { symbol: null, name: null, decimals, type: 'token', asset_path: 'solana/mint/<mint>', detail: { contract: mint } } }`

Aggregation uses `BigInt` on `tokenAmount.amount`.

### `solana-balance-provider.js`

```js
const isUpstreamUnavailable = (e) => (e?.request && !e?.response) || e?.response?.status >= 500;
try { items = await blockdaemon.getBalance(...) }
catch (e) { if (!isUpstreamUnavailable(e)) throw e; console.warn(...); items = await rpcBalanceProvider.getBalance(...) }
```

Same heuristic `src/middlewares/error-handler.js#describe` uses for "no
upstream body".

### Docs

- `AGENTS.md` `multichain-account-balance` bullet: note the Solana RPC fallback and the 4xx-propagates rule.

## Test plan

1. `src/services/solana/__tests__/solana-rpc-balance-provider.spec.js` (new): native + tokens shape, Token-2022 included, per-mint aggregation, RPC rejection propagates, `nodeUrl` used.
2. `solana-balance-provider.spec.js` (extend): timeout → fallback + warn; 5xx → fallback; 404 → propagate, RPC not called; RPC rejects → propagates.
3. CI gate: format, lint, unit, `serverless print`, hermetic redis.
4. Manual: docker-compose rebuild, `GET /local/v1/solana-mainnet/account/<addr>/balance` for the two addresses measured by the frontend session.

## Rollout / rollback

Normal tag flow; no env or config change. Rollback = revert. Watch CloudWatch for the fallback warning line — its frequency is the Blockdaemon health signal.
