# Deploy

## Model

Prod deploys are tag-triggered: push a git tag `prod/vX.Y.Z` from `main`.

`.github/workflows/deploy.yml` runs two jobs:

- **`verify`** — no AWS credentials. `npm ci`, the same `format:check` + `lint:check` gate as `ci.yml`, `test:unit`, and a `serverless print --stage local` sanity check (proves the config resolves without needing AWS/SSM before we trust the same file with the prod stage).
- **`deploy`** (`needs: verify`) — assumes the `GithubActionsRole` via GitHub OIDC (`aws-actions/configure-aws-credentials`), runs `npm run serverless:deploy` (`serverless deploy --stage prod`), then smokes `GET /health` on the stack's execute-api URL (read from `serverless info --verbose`, not CloudFront, whose cache could mask a broken deploy). A red smoke step only alerts — nothing rolls back on its own.

Rollback is a human step, run locally with prod credentials:

```bash
npx serverless deploy list --stage prod          # timestamps of stored artifacts
npx serverless rollback --stage prod --timestamp <t>
```

`concurrency: deploy-prod` (`cancel-in-progress: false`) prevents two tags pushed close together from deploying in parallel.

Only two stages exist: `local` (dev, no AWS) and `prod` (tag-triggered deploy).

## Provisioned but unused: Solana Actions / Blinks infrastructure

The Blinks design (`docs/plans/2026-05-05-solana-actions-blinks.md`, a local
planning note) was never merged: there is no `/v1/solana/actions/*` route, no
`ACTIONS_ICON_BASE_URL` / `STAKE_*` env wiring. Its AWS side, however, was
provisioned and is still live in the prod account (verified 2026-09-09):

| Resource                                                                            | What it is                                                               | Effect today                                                                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| API Gateway custom domain `actions.salmonwallet.io` (EDGE, ACM cert in `us-east-1`) | Base-path mapping `(none)` → the prod REST API, stage `prod`             | **A second public hostname for the entire prod API**, bypassing the main CloudFront distribution. Nothing uses it. |
| CloudFront distribution with alias `cdn.salmonwallet.io`                            | Origin: a private S3 icon bucket ("CDN for Solana Actions/Blinks icons") | Serves 3 icon files (~18 KB). Nothing references them.                                                             |
| The icon bucket                                                                     | Icon bucket, created 2026-05-11                                          | Idle.                                                                                                              |

Both hostnames resolve at the registrar (name.com, managed by the tech lead).
Cost is negligible; the concern is an undocumented hostname in front of prod.

If Blinks is built, reuse these (the design note has the intended layout). If
it is dropped, decommission in this order so nothing dangles:

```bash
# 1. detach the API from the custom domain, then delete the domain
aws apigateway delete-base-path-mapping --domain-name actions.salmonwallet.io --base-path '(none)'
aws apigateway delete-domain-name --domain-name actions.salmonwallet.io
# 2. disable, wait for Deployed, then delete the CDN distribution (needs the ETag)
aws cloudfront get-distribution-config --id <distribution-id>   # set Enabled=false, update, wait
aws cloudfront delete-distribution --id <distribution-id> --if-match <etag>
# 3. empty and delete the bucket
aws s3 rm s3://<icon-bucket> --recursive && aws s3 rb s3://<icon-bucket>
# 4. ask the tech lead to delete the two CNAMEs (actions, cdn) and the ACM
#    validation CNAME for actions.salmonwallet.io; then delete the ACM cert.
```

Resource IDs (distribution, bucket, certificate) are deliberately not in this public doc; they live in the maintainers' private ops notes and are one `aws cloudfront list-distributions` / `aws s3 ls` away. Every step is a prod-account mutation: confirm with the owner first, one step
at a time.

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
