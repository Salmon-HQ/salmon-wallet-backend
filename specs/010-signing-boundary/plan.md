# Implementation Plan: Signing boundary

**Branch**: `010-signing-boundary` (spec only) → **implement on a new branch from `main`** | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

## Summary

Two commits on a fresh branch: (1) the boundary test, written first, red
because `POST /ft/swap/execute` exists and reads `signedTransaction`;
(2) the Ultra swap removal, which turns it green. Then docs/config.

## Technical Context

Node 20 CJS, Express 5, Jest 30. Routers are mounted in `src/index.js`
(cross-chain routers + one per `BLOCKCHAINS` entry). Express 5 exposes the
route table via `app.router.stack` (layers with `.route.path` /
`.route.methods`, nested routers under `layer.handle.stack`).

## Constitution Check (AGENTS.md)

| Gate                                  | Status                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Tests at nearest layer, TDD           | PASS — test first, red → green                                              |
| Public contract change is deliberate  | PASS — `solana-swap-orchestration` removed on purpose; frontend coordinated |
| Never swallow errors / error envelope | N/A                                                                         |
| Frontend usage check before removing  | PASS — swap behind build flag; FE spec 027 rewrites it for v2               |

## Design

### Boundary test — `src/__tests__/signing-boundary.spec.js`

```js
const MUTATING_ROUTE_ALLOWLIST = [
  // Builds an UNSIGNED burn transaction and returns it; never receives signed bytes.
  { method: 'post', path: '/v1/solana-:env/nft/:mintAddress' },
  // Builds an UNSIGNED transfer transaction and returns it; never receives signed bytes.
  { method: 'post', path: '/v1/solana-:env/nft/:mintAddress/transfer' },
];
const SIGNED_TX_FIELDS = ['signedTransaction', 'signedTx', 'tx', 'rawTx', 'serializedTransaction'];
```

1. Build the app (`require('../index')` exports `app` — check; if only
   `handler` is exported, export `app` too, as `index.spec.js` already
   mocks routers it may need the same shape).
2. Walk `app.router.stack` recursively, collecting `{ method, fullPath }`
   for every route; fail on any `post|put|patch|delete` not in the
   allowlist (compare on the mount-prefixed path; the mount loop uses
   `/v1/<chain>-:env`).
3. Static check for the field denylist: for each controller file under
   `src/controllers/**` (excluding tests), fail if the source contains
   `req.body.<field>` or `{ <field> } = req.body` for a denylisted name.
   A source-grep is deliberately simple — it catches the pattern every
   existing controller uses (`const { signedTransaction, requestId } =
req.body`) and needs no runtime instrumentation.
4. Error messages name the route/file and quote the rule from `AGENTS.md`.

Prove SC-001 once: temporarily add a route reading `req.body.tx`, watch
the test fail, revert — note it in the PR.

### Removal

- `src/routes/solana/solana-ft-router.js`: drop the two swap routes and
  the header lines.
- `src/controllers/solana/solana-ft-controller.js`: drop `order`,
  `execute`, `ORDER_REQUIRED_BASE`, `EXECUTE_REQUIRED_PARAMS`, the swap
  service/resource requires; keep `verified`, `search`.
- Delete `src/services/solana/solana-ft-swap-service.js` (+ unit and
  integration specs), `src/resources/solana/solana-swap-order-resource.js`,
  `solana-swap-execute-resource.js` (+ specs).
- `solana-ft-service.js` / `jupiter-token-service.js`: keep; confirm no
  import of the swap service remains (`grep -rn swap-service src`).
- Rate limiter: `src/infrastructure/rate-limiting/rate-limiter.js`
  mentions swap — remove the swap-specific bucket if one exists.
- `network-capabilities-{prod,main,develop,local}.js`: delete the `swap`
  and `exchange` sections; update `network-capabilities-service` tests.
- Config: `config/env.prod.yml`, `config/env.local.yml`, `.env.example`,
  `scripts/ssm-put-params.sh` — remove the three `JUPITER_SWAP_*` vars.
  Keep `JUPITER_API_KEY`, `JUPITER_PRICE_URL`.
- Docs: `docs/openapi.yaml` (two paths + `SwapOrder*`/`SwapExecute*`
  schemas), `docs/ARCHITECTURE.md`, root `AGENTS.md` (contract bullet +
  new "Signing boundary" section), `src/{routes,controllers,services,resources}/solana/AGENTS.md`,
  `.claude/skills/solana-rpc-context/SKILL.md`, `CHANGELOG.md`.

### `AGENTS.md` — "Signing boundary" section (draft text)

> The backend never receives a private key, a seed phrase, or a signed
> transaction, and never broadcasts on a user's behalf. A Powerup's
> backend surface is: quote → unsigned transaction or instructions →
> the client signs on the device → the client broadcasts to its own RPC
> → the backend may read public status. `src/__tests__/signing-boundary.spec.js`
> enforces this: every non-GET route must be in its allowlist with a
> reason, and no controller may read a signed-transaction body field.
> This is what the answer to Apple's 3.1.5(iii) questionnaire and the
> team's legal position rest on — do not weaken it for convenience.

## Test plan

1. Boundary test red on current tree (execute route + `signedTransaction`).
2. Removal → green. `npm run test:unit` (expect ~110 suites after the
   swap specs go), hermetic redis, `serverless print --stage local`,
   OpenAPI parses, format, lint.
3. Manual: docker rebuild, `GET /local/v1/solana-mainnet/ft/swap/order?…` → 404;
   `GET /local/v1/solana-mainnet/ft/verified` → 200 unchanged.

## Rollout / rollback

- Normal PR to `main`; rides the next `prod/vX.Y.Z` tag.
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
