# Implementation Plan: Signing boundary

**Branch**: `feat/swap-0x-signing-boundary` (implemented 2026-09-10, not merged; owner holds the merge for a few days) | **Date**: 2026-09-02, updated 2026-09-10 | **Spec**: [spec.md](./spec.md)

## Summary

Three commits on a branch from `main`: (1) the boundary test, red because
`POST /ft/swap/execute` existed and its controller read
`signedTransaction`; (2) the Ultra swap removal + docs/config, which turned
it green; (3) the 0x build endpoint (spec 012), which stays green because
it is a GET that returns an unsigned transaction.

## Technical Context

Node 24 CJS, Express 5, Jest 30. Routers are mounted in `src/index.js`
(cross-chain routers + one per `BLOCKCHAINS` entry). The test does not
boot the app: every route in the repo is declared as
`router.<method>('<literal path>', …)`, so a source scan sees all of them.

## Constitution Check (AGENTS.md)

| Gate                                  | Status                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Tests at nearest layer, TDD           | PASS — test first, red → green (commits 1 and 2 on the branch)              |
| Public contract change is deliberate  | PASS — `solana-swap-orchestration` removed on purpose; frontend coordinated |
| Never swallow errors / error envelope | N/A                                                                         |
| Frontend usage check before removing  | PASS — swap behind build flag; FE spec 027 rewrites it for the build flow   |

## Design

### Boundary test — `src/__tests__/signing-boundary.spec.js`

As implemented:

```js
const MUTATING_ROUTE_ALLOWLIST = [
  {
    file: 'routes/solana/solana-nft-router.js',
    method: 'post',
    path: '/:mintAddress',
    reason: 'builds an UNSIGNED burn transaction and returns it; never receives signed bytes',
  },
  {
    file: 'routes/solana/solana-nft-router.js',
    method: 'post',
    path: '/:mintAddress/transfer',
    reason: 'builds an UNSIGNED transfer transaction and returns it; never receives signed bytes',
  },
];
const SIGNED_TX_FIELDS = ['signedTransaction', 'signedTx', 'rawTx', 'serializedTransaction'];
const MUTATING_METHODS = ['post', 'put', 'patch', 'delete'];
```

1. Walk `src/routes/**` (skipping `__tests__`) plus `src/index.js`; match
   `/\b(?:router|app)\.(post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g`
   and collect `{ file, method, path }` (`file` relative to `src/`).
2. Fail on any declared route not in the allowlist; fail on any allowlist
   entry with no matching declaration (no stale entries); assert every
   entry's method is a mutating one and its reason contains `UNSIGNED`.
3. Walk `src/controllers/**` and fail if a file's source matches
   `\b<field>\b` for any denylisted field.
4. Assertion messages name the route (`POST /path (file)`) or
   `file: field`, and the comments next to them quote the rule.

SC-001 proof: commit 1 on the branch is the test alone, red on the tree
with the Ultra relay; commit 2 turns it green.

### Removal (done)

- `src/routes/solana/solana-ft-router.js`: the two swap routes and the
  header lines are gone; `GET /swap/build` was added by spec 012.
- `src/controllers/solana/solana-ft-controller.js`: `order`, `execute`,
  `ORDER_REQUIRED_BASE`, `EXECUTE_REQUIRED_PARAMS` and the Ultra
  service/resource requires are gone; `verified`, `search` kept; `build`
  added by spec 012.
- Deleted `src/services/solana/solana-ft-swap-service.js` (+ unit and
  integration specs), `src/resources/solana/solana-swap-order-resource.js`,
  `solana-swap-execute-resource.js` (+ specs).
- `solana-ft-service.js` / `jupiter-token-service.js`: kept.
- `network-capabilities-{prod,main,develop,local}.js`: `exchange` section
  deleted; `swap` kept (see spec Deviations);
  `network-catalog-service` tests updated.
- Config: `config/env.prod.yml`, `config/env.local.yml`, `.env.example`,
  `jest.setup.js`, `scripts/ssm-put-params.sh`, `docs/TESTING.md` — the
  three `JUPITER_SWAP_*` vars removed. `JUPITER_API_KEY`,
  `JUPITER_PRICE_URL` kept.
- Docs: `docs/openapi.yaml` (two paths + `SwapOrder*`/`SwapExecute*`
  schemas replaced by `/ft/swap/build` + `SwapBuild`), root `AGENTS.md`
  (contract bullet replaced by `solana-swap-build` + new "Signing
  boundary" section), `src/services/solana/AGENTS.md`,
  `src/network-capabilities/AGENTS.md`,
  `.claude/skills/solana-rpc-context/SKILL.md`, `README.md`,
  `CHANGELOG.md` (`## Unreleased`, breaking entry).

### `AGENTS.md` — "Signing boundary" section (as merged into the branch)

> The backend never receives a private key, a seed phrase or a signed
> transaction, and never broadcasts on a user's behalf. A Powerup's
> backend surface is: quote → unsigned transaction (or instructions) →
> the client signs on the device → the client broadcasts to its own RPC
> → the backend may read public status. `src/__tests__/signing-boundary.spec.js`
> enforces it: every non-GET route must be in its allowlist with a reason
> (only routes that BUILD an unsigned transaction qualify — NFT
> burn/transfer today), and no controller may mention a
> signed-transaction body field. The Jupiter Ultra `/ft/swap/order` +
> `/ft/swap/execute` relay was removed for this reason (the wallet's
> Apple 3.1.5(iii) answer rests on it); a replacement swap is build-only.

## Deviations from the written plan

- Source scan, not `app.router.stack` walk; no `app` export was needed
  from `src/index.js`.
- Denylist without bare `tx`; whole-word match on the controller source
  rather than `req.body.<field>` patterns only.
- `sections.swap` kept; only `exchange` removed.
- The rate limiter had no swap-specific bucket to remove; spec 012 added
  a separate `zeroex-rate-limiter` instead.

## Test plan

1. Boundary test red on the pre-removal tree (commit 1). Done.
2. Removal → green (commit 2). `npm run test:unit`, hermetic redis,
   `serverless print --stage local`, OpenAPI parse, format, lint on the
   branch before the PR gate.
3. Manual, after merge: docker rebuild,
   `GET /local/v1/solana-mainnet/ft/swap/order?…` → 404;
   `GET /local/v1/solana-mainnet/ft/verified` → 200 unchanged.

## Rollout / rollback

- Normal PR to `main`; rides the next `prod/vX.Y.Z` tag together with
  spec 012.
- After deploy, ops deletes the three `JUPITER_SWAP_*` SSM parameters.
- Rollback = revert; the referral account and any accrued fees are
  on-chain and unaffected.

## Ops checklist (outside the repo)

```bash
aws ssm delete-parameters --names \
  /salmon-api/prod/JUPITER_SWAP_URL \
  /salmon-api/prod/JUPITER_SWAP_REFERRAL_ACCOUNT \
  /salmon-api/prod/JUPITER_SWAP_REFERRAL_FEE_BPS
```
