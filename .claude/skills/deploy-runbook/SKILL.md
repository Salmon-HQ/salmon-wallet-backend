---
name: deploy-runbook
description: How this API is deployed and run (Serverless Framework v3, AWS Lambda us-east-1, Redis) — functions and crons, env vars, deployer permissions, known quirks, and the local Docker environment. ALWAYS use before touching serverless.yml, adding a function/cron, changing env vars, or debugging a failed deploy.
---

# Deploy Runbook — salmon-api

## Deploy stack

- `serverless.yml`: service `gol-salmon-api`, Serverless Framework **v3**, `nodejs24.x`, region `us-east-1`, default stage `prod`, `versionFunctions: false`.
- Functions: `api` (`src/index.handler`, ANY proxy, timeout 60), `events` (`src/analytics/handler.handler`, explicit `POST /v1/events`), crons `listTokensJob` (1h, bitcoin), `refreshPricesJob` (60min, bitcoin), `refreshSanctionsJob` (1 day, the sanctions list swap screening reads) and `recordSkrSharePriceJob` (02:05 UTC daily).
- Runtime IAM: one statement, `ssm:GetParameter` on `/salmon-api/<stage>/AVAILABILITY_TABLE` (the availability table, read at runtime). A new capability means a specific statement, not a wildcard.
- Deployer policy: `aws-deploy-policy.json` — CloudFormation, IAM scoped to `role/gol-salmon-api-*`, Lambda scoped to the service, deployment-bucket S3, EventBridge, CloudFront/Lambda@Edge.
- CI/CD: `.github/workflows/deploy.yml`, triggered by pushing a `prod/vX.Y.Z` tag and by a schedule on the 2nd of every month (06:30 UTC) that redeploys the newest `prod/v*` tag, so prod always ships the month's DB-IP country database (on prod a database older than 45 days closes Swap). Job `target` (the pushed tag, or the newest one) → job `verify` (no AWS: `npm ci` + lint + `test:unit` + `serverless print --stage local` as a config check) → job `deploy` (runs `node scripts/refresh-geo-data.mjs` before it holds AWS credentials, and a download or check failure fails the deploy; then assumes the GitHub Actions role via OIDC, runs `npm run serverless:deploy`, and fails its smoke step when `/status` reports no `countryDatabase`). Rollback caveats (database age, never below 0.26.0, the monthly run redeploys the newest tag) are in `docs/DEPLOY.md`. `concurrency: deploy-prod` prevents overlapping deploys. The old `.github/workflows/build.yml` (auto-deploy to develop/main on push) was removed — see `docs/DEPLOY.md`.

## Known quirks (do not "fix" these without knowing this)

- `serverless-import-config-plugin` and `serverless-plugin-warmup` were removed from devDependencies (never listed in `serverless.yml#plugins`; import-config was incompatible with v3 and carried an unfixable `lodash.set` advisory). Do not re-add without wiring them in.
- There is no SQL database. The former MySQL layer was fully removed (prod RDS decommissioned): no `packages/mysql-connector`, no `migrations/`, no `DB_*` env vars.

## Env vars (groups in serverless.yml)

Redis · CoinGecko (`COINGECKO_API_KEY`, `COINGECKO_API_URL`) · Powerups (`POWERUP_PRIORITY_FEE_MICROLAMPORTS`) · Solana (`TRITON_*`) · GA4 · rate limiting (`RATE_LIMIT_*`). Secrets are never committed in the yml. Per-stage indirection via `config/env.<stage>.yml` (`custom.envFile` in `serverless.yml`): `local` reads from `.env` (`serverless-dotenv-plugin`, only to populate `process.env` — its auto-inject is off via `dotenv.include: []`), `prod` reads from AWS SSM Parameter Store (`/salmon-api/prod/*`, SecureString). To add/rotate a prod secret: edit the param in SSM (or run `scripts/ssm-put-params.sh --execute` to re-seed from the live Lambda + `.env` fallback for new vars) and re-deploy. The development `.env` intentionally diverges from prod — it is never a source of truth for SSM except that fallback exception. See `docs/DEPLOY.md`.

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
