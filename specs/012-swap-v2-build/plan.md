# Implementation Plan: Swap v2 — build on 0x

**Branch**: `feat/swap-0x-signing-boundary` (implemented 2026-09-10, not merged; owner holds the merge for a few days) | **Date**: 2026-09-02, updated 2026-09-10 | **Spec**: [spec.md](./spec.md)

## Summary

One new GET route, a 0x adapter (`POST /solana/swap-instructions`), a
build service that compiles the returned instructions into an unsigned v0
transaction with Salmon's fee inside, server-side fee config, a response
resource hydrated with Jupiter token metadata / prices, and no
execute/broadcast surface. Region gating (spec 011) is not wired.

## Technical Context

Node 24 CJS, Express 5, Jest 30, `@solana/web3.js` 1.99.0-beta.0
(`TransactionMessage`, `AddressLookupTableAccount`, `VersionedTransaction`,
`ComputeBudgetProgram`), `@solana/spl-token` `getAssociatedTokenAddressSync`,
axios. 0x base `https://api.0x.org/solana` (`ZEROEX_API_URL`), header
`0x-api-key` from `ZEROEX_API_KEY`; 10 s request timeout. Existing pieces
reused: `RateLimiter` + `createWithRetry` (new `zeroex-rate-limiter`
instance), `error-handler.js` (renders `statusCode` / `errorCode` from the
swap error classes), `solana-ft-router` (mount point), `solana-ft-service`
`getByMints` (decimals for `uiAmount`), `jupiter-token-service` +
`jupiter-service` (metadata + USD values in the resource),
`utils/solana-address` (`findInvalidAddressParam`).

## Constitution Check (AGENTS.md)

| Gate                               | Status                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| Signing boundary (spec 010)        | PASS — GET only; no signed bytes accepted; no broadcast; boundary suite green                   |
| Orchestration/fallback in services | PASS — fee policy, ALT/blockhash assembly, fee check in `services/solana/swap/`                 |
| Resources own public shape         | PASS — `solana-swap-build-resource.js` is the `SwapBuild` schema                                |
| Never 200 with degraded data       | PASS — missing fee account → 503; fee not in tx → 502; no route → 404 with reason               |
| Secrets in SSM                     | PASS — `ZEROEX_API_KEY`, `SWAP_FEE_*` via SSM with `''` fallback; no keys in repo               |
| Frontend contract coordinated      | PASS — shape agreed with spec 027 (`salmonFee.decimals/symbol` added at the frontend's request) |
| Region gating (spec 011)           | PENDING — not mounted; route open once `ZEROEX_API_KEY` is set                                  |

## Design

```
src/services/solana/swap/
├── zeroex-swap-provider.js       # POST /swap-instructions: snake_case body, fee in ppm (bps*100) on the buy side,
│                                 #   byte-array instructions → TransactionInstruction; 0x 400 → SolanaSwapNoRouteError
├── solana-swap-build-service.js  # resolveAmount/resolveSlippage (400 envelopes); resolveFeeRecipient (owner ATA per
│                                 #   output mint under the mint's own program, wallet for SOL; getAccountInfo → 503);
│                                 #   requestSwapInstructions; assertFeeInstructionPresent (→ 502); fetch ALTs +
│                                 #   blockhash; optional ComputeBudget price ix (+52 reserved bytes); compileToV0Message;
│                                 #   serialize unsigned; estimateFeeAmount; expiresAt = now + 60 s
└── solana-swap-errors.js         # SolanaSwapError { statusCode, errorCode }: no_route 404, wallet_restricted 403,
                                  #   provider_fee_mismatch 502
src/infrastructure/rate-limiting/zeroex-rate-limiter.js   # 5 RPS default (ZEROEX_MAX_RPS), retry 429/5xx, honors Retry-After
src/resources/solana/solana-swap-build-resource.js       # SwapBuild shape; Jupiter Tokens v2 metadata + Price v3 USD values
src/controllers/solana/solana-ft-controller.js           # build(): required params, address validation, mints differ,
                                                         #   solana-mainnet only, slippage/amount resolution → service → resource
src/routes/solana/solana-ft-router.js                    # GET /swap/build (no cache)
```

Flow: controller validates → service resolves the fee recipient and
checks it exists → 0x call (rate-limited) → fee presence check → ALTs +
blockhash → optional priority-fee instruction → compile v0 → serialize →
resource hydrates tokens/prices. The transaction is unsigned by
construction (the backend never holds a key); the service test decodes it
and asserts every signature slot is zero.

Fee verification: 0x returns no fee amount, so the service asserts the
fee recipient appears in the accounts of at least one returned
instruction; otherwise 502 `provider_fee_mismatch` (never return a
transaction whose fee we cannot see). The displayed fee is
`ceil(net × ppm / (1e6 − ppm))` from `amount_out` (net of the buy-side
fee, rounded up by 0x).

Response (`solana-swap-build` contract, `SwapBuild` in `docs/openapi.yaml`):

```json
{
  "provider": "0x",
  "providerDisplayName": "0x",
  "attribution": "Powered by 0x",
  "providerRequestId": "<0x zid>",
  "transaction": "<base64 unsigned v0>",
  "expiresAt": "<iso, build + 60 s>",
  "input": {
    "mint": "…",
    "amount": "1000000",
    "decimals": 6,
    "symbol": "USDC",
    "name": "…",
    "logo": "…"
  },
  "output": {
    "mint": "…",
    "amount": "623000000",
    "minAmount": "620000000",
    "decimals": 9,
    "symbol": "SOL",
    "name": "…",
    "logo": "…"
  },
  "route": [{ "label": "Raydium", "percent": 100 }],
  "priceImpactPct": 0.01,
  "slippageBps": 50,
  "inUsdValue": 1.0,
  "outUsdValue": 0.9999,
  "salmonFee": { "amount": "3115000", "mint": "…SOL", "bps": 50, "decimals": 9, "symbol": "SOL" },
  "routeFee": null
}
```

Errors: 400 `missing_parameter` / `invalid_parameter` / `unknown_mint`
(local validation before any upstream call; includes non-mainnet
network); 404 `no_route` with 0x's reason (`error` or gateway `message`);
502 `provider_fee_mismatch`; 0x 401/429/5xx
and RPC failures (e.g. an ALT the provider named is not on chain) → 500
via `error-handler`. 403 `region_restricted` / `wallet_restricted` arrive
with spec 011.

Config: `ZEROEX_API_URL` (default `https://api.0x.org/solana`),
`ZEROEX_API_KEY`, `ZEROEX_MAX_RPS` (default 5), `SWAP_FEE_BPS` (int),
`SWAP_FEE_ACCOUNT_OWNER` (base58 pubkey — the wallet that owns the fee
token accounts; **its private key is never in any system Salmon runs**),
`SWAP_PRIORITY_FEE_MICROLAMPORTS` (0/unset = none). All in
`config/env.{prod,local}.yml`, `.env.example`, `scripts/ssm-put-params.sh`.

## Deviations from the written plan

- No `swap-provider.js` interface, `swap-provider-registry.js` or
  `SWAP_PROVIDER_BY_COUNTRY`; one adapter called directly. A second
  provider would be a sibling of `zeroex-swap-provider.js` returning the
  same `{ instructions, lookupTableAddresses, amountOut, minAmountOut, routePlan, zid }`
  plus a selector in front of the call in `solana-swap-build-service.js`.
- No separate `swap-fee-service.js`; `resolveFeeRecipient` lives in the
  build service. Fee side is fixed to the output token (0x has no
  provider-chosen fee mint).
- No `powerupGate` on the route (spec 011 pending).
- Unsigned-ness is by construction (backend compiles the message itself)
  rather than by deserializing a provider transaction; fee presence is an
  account-reference check, not an amount check (0x returns no fee
  amount).
- `resolveAmount` / `resolveSlippage` validation lives in the build
  service and is called from the controller.
- Nightly `swap-build.integration.spec.js` not written yet (needs a real
  0x key).

## Test plan

- Unit (on the branch):
  `src/services/solana/swap/__tests__/zeroex-swap-provider.spec.js`
  (snake_case body + ppm fee, no fee fields when unconfigured, 0x 400 →
  404 with reason, 5xx/401 propagate);
  `src/services/solana/swap/__tests__/solana-swap-build-service.spec.js`
  (unsigned v0 paid by the taker, fee to owner ATA / to wallet for SOL,
  503 before the provider call, 502 on missing fee reference, priority
  fee + reserved bytes, missing ALT fails loudly, `estimateFeeAmount`,
  `resolveAmount`, `resolveSlippage`);
  `src/resources/solana/__tests__/solana-swap-build-resource.spec.js`
  (shape, null USD fields, null fee);
  `src/controllers/solana/__tests__/solana-ft-controller.spec.js` (required
  params, invalid address / same mints / non-mainnet, 400 envelopes from
  resolution, fee params never forwarded);
  `src/routes/solana/__tests__/solana-ft-router.spec.js` (mounts
  `/swap/build`, not `/swap/order`).
- Spec 010 boundary test stays green (GET only).
- Pending: nightly `swap-build.integration.spec.js` in
  `integration-external.yml` — real build on mainnet for a tiny USDC→SOL
  amount with a real key; assert unsigned + fee recipient referenced;
  **do not broadcast**.
- Manual, pending a real key: docker, curl build → decode with a script;
  sign + send from the wallet build (spec 027) on mainnet with a tiny
  amount; confirm the fee lands; settle the UNVERIFIED items in the spec.

## Rollout / rollback

- Ships dark: without `ZEROEX_API_KEY` in SSM every build fails upstream
  (0x 401 → 500); without `SWAP_FEE_BPS` + `SWAP_FEE_ACCOUNT_OWNER` a
  build carries no fee. Enabling = put the four SSM parameters and
  redeploy (config is read at request time, but the Lambda env comes from
  the deploy).
- Spec 011 must land before Swap is enabled for end users in production
  (owner decision on countries).
- Rollback = remove the SSM key / revert; nothing custodial to unwind.
- Watch: CloudWatch for `provider_fee_mismatch` / `[SWAP_FEE_SKIPPED]`
  rates, 0x 429s from the rate limiter, and `no_route` reasons.

## Ops checklist (outside the repo)

- 0x dashboard: create the API key; decide the plan / RPS
  (`ZEROEX_MAX_RPS`).
- Create fee token accounts (ATAs) for USDC, USDT (and any other common
  output mint) owned by `SWAP_FEE_ACCOUNT_OWNER`; native SOL fees go to
  the wallet itself.
- SSM: `/salmon-api/prod/ZEROEX_API_URL` (optional),
  `/salmon-api/prod/ZEROEX_API_KEY`, `/salmon-api/prod/SWAP_FEE_BPS`,
  `/salmon-api/prod/SWAP_FEE_ACCOUNT_OWNER`,
  `/salmon-api/prod/SWAP_PRIORITY_FEE_MICROLAMPORTS` (optional).
- Real-key probe for the UNVERIFIED items listed under "Open decisions
  (owner)" in the spec (native SOL address, fee-recipient auto-create,
  0x cut / trade surplus, error `code` strings).
- Counsel: written opinion for each country before it enters the spec 011
  allowlist.
