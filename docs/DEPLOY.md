# Deploy

## Model

Prod deploys are tag-triggered: push a git tag `prod/vX.Y.Z` from `main`.

`.github/workflows/deploy.yml` runs two jobs:

- **`verify`** — no AWS credentials. `npm ci`, lint, `test:unit`, and a `serverless print --stage local` sanity check (proves the config resolves without needing AWS/SSM before we trust the same file with the prod stage).
- **`deploy`** (`needs: verify`) — assumes the `GithubActionsRole` via GitHub OIDC (`aws-actions/configure-aws-credentials`), then runs `npm run serverless:deploy` (`serverless deploy --stage prod`).

`concurrency: deploy-prod` (`cancel-in-progress: false`) prevents two tags pushed close together from deploying in parallel.

Only two stages exist: `local` (dev, no AWS) and `prod` (tag-triggered deploy).

## Secrets: SSM Parameter Store

Prod env values live in **AWS SSM Parameter Store** under `/salmon-api/prod/*`, type `SecureString`, region `us-east-1`.

- `config/env.prod.yml` — the map of `${ssm:/salmon-api/prod/X}` refs consumed by `serverless.yml` via `custom.envFile`. Vars that previously had an `${env:X, <default>}` fallback keep a matching `${ssm:X, <default>}` fallback, so an optional/missing param doesn't break a deploy. Vars that were previously required (no default) stay strict and fail the deploy loudly if the param is missing.
- `config/env.local.yml` — the local/dev mirror: every var comes from `${env:X, ''}`, loaded from `.env` via `serverless-dotenv-plugin`. The `local` stage never touches AWS.

## Adding or rotating a secret

1. Write the parameter directly:
   ```bash
   aws ssm put-parameter \
     --name "/salmon-api/prod/YOUR_VAR" \
     --type SecureString \
     --value "new-value" \
     --overwrite \
     --region us-east-1
   ```
2. New var: add it to `config/env.prod.yml` (`${ssm:/salmon-api/prod/YOUR_VAR}`), `config/env.local.yml` (`${env:YOUR_VAR, ''}`), and the `PARAM_NAMES` list in `scripts/ssm-put-params.sh`.
3. Push a new `prod/vX.Y.Z` tag to roll it out. Lambda env vars only refresh on deploy, not live.

## One-time / bulk seeding

`scripts/ssm-put-params.sh` seeds params from the **live prod Lambda's env vars** (`gol-salmon-api-prod-api` — what's actually running in prod today), falling back to local `.env` only for vars that don't exist on the Lambda yet (new, never-deployed vars, e.g. `GA4_MEASUREMENT_ID`/`GA4_API_SECRET`).

It deliberately does **not** use `.env` as a general source: local dev values intentionally diverge from prod (dev-safe values, cost/blast-radius isolation), so seeding SSM from `.env` wholesale would push dev values into prod.

```bash
./scripts/ssm-put-params.sh          # dry-run (default) — prints param NAMES only, never values
./scripts/ssm-put-params.sh --execute
```

After this one-time seed, SSM is the single source of truth for prod — rotate via "Adding or rotating a secret" above, not `.env`.

## Local development

Unchanged: `cp .env.example .env`, fill in values, `npm run serverless:start:local`. No AWS credentials needed — `config/env.local.yml` only ever reads `.env`/`process.env`.

## GitHub repo secrets

No deploy workflow reads GitHub repo secrets; any entries remaining under Settings → Secrets can be deleted.

## CI IAM permissions

The GitHub Actions OIDC role's live policy (`GithubActionsPolicy` in AWS — **not** the repo's `aws-deploy-policy.json`, which is an unapplied least-privilege draft) can read `/salmon-api/prod/*` from SSM: the `v0.14.0` tag deploy resolved every `${ssm:...}` ref and completed successfully. Keep any future tightening scoped to `ssm:GetParameter*` on that prefix.
