# Implementation Plan: Swap v2 build

**Branch**: `012-swap-v2-build` (spec only) → **implement on a new branch from `main`** after specs 010 and 011 | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

## Summary

One new GET route behind `powerupGate('swap')`, a `SwapProvider`
interface with a Jupiter `/swap/v2/build` adapter, server-side fee
config, a unified response resource, and no execute/broadcast surface.

## Technical Context

Node 20 CJS, Express 5, Jest 30, `@solana/web3.js` 1.x for decoding the
returned transaction (to assert unsigned + fee instruction). Jupiter Swap
V2 base `https://api.jup.ag/swap/v2`, `x-api-key` from `JUPITER_API_KEY`.
Existing pieces reused: `jupiter-rate-limiter`, `error-handler.js`
upstream mapping, `network-capabilities` loader (via spec 011),
`solana-ft-router` (mount point), `jupiter-token-service` (mint metadata
for `input`/`output` display).

## Constitution Check (AGENTS.md)

| Gate                               | Status                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Signing boundary (spec 010)        | PASS — GET only; no signed bytes accepted; no broadcast                  |
| Orchestration/fallback in services | PASS — provider selection + fee policy in `services/solana/swap/`        |
| Resources own public shape         | PASS — `solana-swap-build-resource.js`                                   |
| Never 200 with degraded data       | PASS — missing fee account → 503; no route → 404 with reason             |
| Secrets in SSM                     | PASS — `SWAP_FEE_BPS`, `SWAP_FEE_ACCOUNT_OWNER` via SSM; no keys in repo |
| Frontend contract coordinated      | PASS — shape agreed with spec 027 on 2026-09-02                          |

## Design

```
src/services/solana/swap/
├── swap-provider.js            # interface JSDoc: build({ inputMint, outputMint, amount, slippageBps, userPublicKey }) → BuildResult
├── providers/jupiter-swap-provider.js   # GET /swap/v2/build (+ /quote if needed); adds platformFeeBps/feeAccount
├── swap-fee-service.js         # resolves feeAccount for the fee mint Jupiter picks; verifies the ATA exists (RPC getAccountInfo); 503 if missing
├── swap-provider-registry.js   # config-driven: country → provider id (default 'jupiter')
└── swap-build-service.js       # orchestration: gate already ran → pick provider → build → decode/verify unsigned + fee ix → shape
src/resources/solana/solana-swap-build-resource.js
src/controllers/solana/solana-ft-controller.js   # + build()
src/routes/solana/solana-ft-router.js            # GET /swap/build with powerupGate('swap', { addressParam: 'publicKey' })
```

Verification inside `swap-build-service`: deserialize the returned
`VersionedTransaction`; assert `signatures` are all empty; assert an
instruction transferring to `feeAccount` exists with amount ≥ expected
(`amountOut * bps / 10_000` within Jupiter's rounding); otherwise 502
`provider_fee_mismatch` (never return a transaction whose fee we cannot
see — the old service only logged this).

Response (`solana-swap-build` contract):

```json
{
  "provider": "jupiter",
  "providerDisplayName": "Jupiter",
  "attribution": "Powered by Jupiter (Swap API v2)",
  "transaction": "<base64 unsigned>",
  "expiresAt": "<iso>",
  "input": { "mint": "…", "amount": "1000000", "decimals": 6, "symbol": "USDC" },
  "output": {
    "mint": "…",
    "amount": "623000000",
    "decimals": 9,
    "symbol": "SOL",
    "minAmount": "620000000"
  },
  "route": [{ "label": "Raydium", "percent": 100 }],
  "priceImpactPct": "0.01",
  "slippageBps": 50,
  "salmonFee": { "amount": "3115000", "mint": "…SOL", "bps": 50 },
  "routeFee": { "amount": "0", "mint": "…SOL" }
}
```

Errors: 400 `missing_parameter`/`invalid_parameter` (local validation
before any upstream call); 403 `region_restricted` / `wallet_restricted`
(gate); 404 `no_route` with provider reason; 502 `provider_fee_mismatch`;
503 `fee_account_missing`; upstream 5xx → 500 via `error-handler`.

Config: `SWAP_FEE_BPS` (int), `SWAP_FEE_ACCOUNT_OWNER` (base58 pubkey —
the wallet that owns the fee token accounts; **its private key is never
in any system Salmon runs**), `SWAP_PROVIDER_BY_COUNTRY` (optional JSON,
default all → jupiter). Fee ATAs derived server-side with
`findAssociatedTokenAddress` (spec 006 keeps this local).

## Test plan

- Unit: Jupiter adapter with recorded fixtures (build success, no route,
  4xx, 5xx); fee service (ATA exists / missing); build service
  (unsigned assertion, fee instruction assertion, mismatch → 502);
  resource shape; controller validation; route mounts the gate (mock).
- Spec 010 boundary test stays green (GET only).
- Nightly `swap-build.integration.spec.js`: real build on mainnet for a
  tiny USDC→SOL amount; assert unsigned + fee ix; **do not broadcast**.
- Manual: docker, curl build → decode with a script; sign + send from the
  wallet build (spec 027) on devnet; confirm fee lands.

## Rollout / rollback

- Ship with `powerups.swap.enabled=false` and an empty country list
  (spec 011); enabling is a config PR with the evidence linked
  (provider terms + counsel note per country).
- Rollback = flip `enabled` or revert; nothing custodial to unwind.
- Watch: CloudWatch for `provider_fee_mismatch` / `fee_account_missing`
  rates and the gate's `region_restricted` counts per country.

## Ops checklist (outside the repo)

- Create fee token accounts (ATAs) for SOL/WSOL, USDC, USDT (and any
  other allowed fee mint) owned by `SWAP_FEE_ACCOUNT_OWNER`.
- SSM: `/salmon-api/prod/SWAP_FEE_BPS`, `/salmon-api/prod/SWAP_FEE_ACCOUNT_OWNER`.
- Jupiter portal: confirm key tier / RPS for `/swap/v2/*`.
- Counsel: written opinion for each country before it enters the allowlist.
