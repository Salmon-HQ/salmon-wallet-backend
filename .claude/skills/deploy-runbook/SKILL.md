---
name: deploy-runbook
description: How this API is deployed and run (Serverless Framework v3, AWS Lambda us-east-1, Redis) — functions and crons, env vars, deployer permissions, known quirks, and the local Docker environment. ALWAYS use before touching serverless.yml, adding a function/cron, changing env vars, or debugging a failed deploy.
---

# Deploy Runbook — salmon-api

## Deploy stack

- `serverless.yml`: service `gol-salmon-api`, Serverless Framework **v3**, `nodejs20.x`, region `us-east-1`, default stage `prod`, `versionFunctions: false`.
- Functions: `api` (`src/index.handler`, ANY proxy, timeout 60), `events` (`src/analytics/handler.handler`, explicit `POST /v1/events`), crons `listTokensJob` (1h, bitcoin) and `refreshPricesJob` (60min, bitcoin).
- Runtime IAM: no statements — the service needs none. A new capability means a specific statement, not a wildcard.
- Deployer policy: `aws-deploy-policy.json` — CloudFormation, IAM scoped to `role/gol-salmon-api-*`, Lambda scoped to the service, deployment-bucket S3, EventBridge, CloudFront/Lambda@Edge.
- CI/CD: `.github/workflows/deploy.yml`, triggered by pushing a `prod/vX.Y.Z` tag. Job `verify` (no AWS: `npm ci` + lint + `test:unit` + `serverless print --stage local` as a config check) → job `deploy` (`needs: verify`, assumes the GitHub Actions role via OIDC, runs `npm run serverless:deploy`). `concurrency: deploy-prod` prevents overlapping deploys. The old `.github/workflows/build.yml` (auto-deploy to develop/main on push) was removed — see `docs/DEPLOY.md`.

## Known quirks (do not "fix" these without knowing this)

- `serverless-import-config-plugin` and `serverless-plugin-warmup` were removed from devDependencies (never listed in `serverless.yml#plugins`; import-config was incompatible with v3 and carried an unfixable `lodash.set` advisory). Do not re-add without wiring them in.
- There is no SQL database. The former MySQL layer was fully removed (prod RDS decommissioned): no `packages/mysql-connector`, no `migrations/`, no `DB_*` env vars.
- The bridge surface was removed, so the SSM parameters `/salmon-api/prod/STEALTHEX_URL` and `/salmon-api/prod/STEALTHEX_API_KEY` are now unused and can be deleted by ops. Nothing in this repo reads them; leaving them in place is harmless.

## Env vars (groups in serverless.yml)

Redis · Jupiter (`JUPITER_*`) · Solana (`TRITON_*`, `HELIUS_API_KEY`, `SOLANA_FALLBACK_MAX_RPS`) · GA4 · rate limiting (`RATE_LIMIT_*`). Secrets are never committed in the yml. Per-stage indirection via `config/env.<stage>.yml` (`custom.envFile` in `serverless.yml`): `local` reads from `.env` (`serverless-dotenv-plugin`, only to populate `process.env` — its auto-inject is off via `dotenv.include: []`), `prod` reads from AWS SSM Parameter Store (`/salmon-api/prod/*`, SecureString). To add/rotate a prod secret: edit the param in SSM (or run `scripts/ssm-put-params.sh --execute` to re-seed from the live Lambda + `.env` fallback for new vars) and re-deploy. The development `.env` intentionally diverges from prod — it is never a source of truth for SSM except that fallback exception. See `docs/DEPLOY.md`.

## Local

- `docker-compose.yml`: `redis:7-alpine`, `backend` (target `development`, hot-reload of `src/`, `packages/`; healthcheck `/local/health`). Overrides: `REDIS_HOST=redis`.
- Offline: `serverless-offline` on ports 3000 (HTTP) / 3002 (Lambda).

## Tests

Unit vs integration naming and the hermetic `jest.setup.js` behavior are a
repo rule — see "Testing rules" in the root `AGENTS.md` and `docs/TESTING.md`.

## Reviewing deploy changes

Review every serverless.yml/IAM change for least privilege, DLQs, and
throttling of public endpoints. If your environment provides a serverless
deploy review skill or agent, run it; otherwise apply that checklist manually.
