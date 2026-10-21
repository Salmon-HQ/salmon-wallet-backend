# Deploy

## Model

Prod deploys are tag-triggered: push a git tag `prod/vX.Y.Z` from `main`. A scheduled run on the 2nd of every month redeploys the newest `prod/v*` tag as it is (see [The monthly country database](#the-monthly-country-database)).

`.github/workflows/deploy.yml` runs three jobs:

- **`target`** — picks the tag to ship: the pushed one, or on the scheduled run the newest `prod/v*` by version. Both jobs below check out that tag.
- **`verify`** — no AWS credentials. `npm ci`, the same `format:check` + `lint:check` gate as `ci.yml`, `test:unit`, and a `serverless print --stage local` sanity check (proves the config resolves without needing AWS/SSM before we trust the same file with the prod stage).
- **`deploy`** (`needs: [target, verify]`) — first runs `node scripts/refresh-geo-data.mjs` (downloads and checks the month's DB-IP country database, before the job holds any AWS credentials; a download or check failure fails the deploy), then assumes the `GithubActionsRole` via GitHub OIDC (`aws-actions/configure-aws-credentials`), runs `npm run serverless:deploy` (`serverless deploy --stage prod`), runs `refreshSanctionsJob` once, then smokes `GET /health` on the stack's execute-api URL (read from `serverless info --verbose`, not CloudFront, whose cache could mask a broken deploy) and fails when `GET /status` reports no `countryDatabase`, since Swap is then closed. A red smoke step only alerts — nothing rolls back on its own.

Rollback is a human step, run locally with prod credentials:

```bash
npx serverless deploy list --stage prod          # timestamps of stored artifacts
npx serverless rollback --stage prod --timestamp <t>
```

Each artifact carries the country database of the deploy that built it. That database is DB-IP's edition of the 1st of the month the artifact was deployed in (of the month before, for a deploy early on the 1st), so check the target's timestamp before rolling back: once its database is more than 45 days old, prod places nobody and Swap closes everywhere. Never roll back to an artifact older than 0.26.0 without the owner: those place a caller whose country is unknown as unrestricted and carry a looser built-in table. After a rollback the newest `prod/v*` tag is still the release that was rolled back, and the monthly run on the 2nd redeploys it; before the 2nd, push a fix as a new tag or delete the bad tag so the newest one is the release now running.

`concurrency: deploy-prod` (`cancel-in-progress: false`) prevents two tags pushed close together from deploying in parallel.

Three stages exist: `local` (dev, no AWS), `prod` (tag-triggered deploy), and `staging`.

`staging` is a mirror of `prod` for testing a branch before it ships: stack `gol-salmon-api-staging`, params under `/salmon-api/staging/*`, capabilities in `network-capabilities-staging.js` (the Powerups under test are on there and off in prod). It is deployed by hand from the branch under test, never by CI:

```bash
eval "$(aws configure export-credentials --format env)"   # Serverless v3 does not read an `aws login` session
npm run serverless:deploy:staging
```

The script first runs `node scripts/refresh-geo-data.mjs`, so staging ships the month's DB-IP country database like prod; a failed download stops it before anything is deployed. Staging holds to the same 45-day limit as prod: a staging stack not redeployed for 45 days places nobody and refuses every swap. It then runs `refreshSanctionsJob` once. Swap screening reads the sanctions list from Redis and only that daily job fills it, so a fresh or emptied Redis would otherwise block every swap for up to a day. A failed refresh prints a warning and leaves the deploy in place.

Staging differs from prod on purpose in three places: the Powerups switched on for testing, analytics written to Lambda's `/tmp` instead of GA4 (so testers never reach the production property), and Redis on Upstash over TLS. It shares every provider key with prod, so a load test against staging spends prod's provider quotas.

## Release, step by step

The owner's order is staging first, then prod, so a change runs on the staging stack before it reaches users:

1. Open the PR from the feature branch to `main`, and a second PR from the same branch to `staging`. The repository allows squash merges only.
2. Squash-merge the `staging` PR, then deploy staging by hand from `origin/staging` (the commands above; `aws login` first, since the session expires). Smoke it against the staging execute-api URL the deploy prints, for example `GET /v1/solana-mainnet/powerups/availability` with each `X-Salmon-Platform`.
3. Squash-merge the `main` PR. `main` requires an approving review; while the owner is the only developer, the merge uses `gh pr merge --squash --admin`.
4. Tag the merge commit `prod/vX.Y.Z`, matching `package.json#version` and the CHANGELOG entry, and push the tag. The `deploy.yml` run verifies, deploys and smokes `/health`; its log prints the prod execute-api URL.
5. A red `verify` caused by a timing test is rerun with `gh run rerun <id> --failed`; any other red stops the release.

### The monthly country database

Each prod deploy downloads that month's DB-IP country database (`scripts/refresh-geo-data.mjs`; the previous month's early on the 1st, before DB-IP publishes), rebuilds the Ukrainian region ranges from the same month's City Lite, and checks known addresses in the US, GB, IR, CU and CN plus all six regions; any failure fails the deploy. Prod stops placing callers once the database is 45 days old, which switches Swap off everywhere. DB-IP publishes on the 1st, so `deploy.yml` also runs on a schedule, the 2nd of every month at 06:30 UTC, and redeploys the newest `prod/v*` tag with that month's database: no release is needed to keep Swap open. The nightly `production country gate` job (`integration-external.yml`) goes red when the database is more than 35 days old (the monthly run failed or did not run; find out why and get a deploy out before day 45), when prod cannot place the runner's address, and when a request from a US runner is not routed to 0x.

## AWS WAF in front of the API

Every deployed stage (`prod`, `staging`; never `local`) gets a regional AWS WAF web ACL, `gol-salmon-api-<stage>-api`, associated with its API Gateway stage (`resources` in `serverless.yml`). Its one rule, `per-ip-rate-limit`, acts on a source IP that sends more than `custom.wafRateLimitPerIp` requests (300) in any 60 seconds; every other request is allowed. The number matches the Express per-IP limit (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_SECONDS`, `src/index.js`), so it acts on no caller the API would have served. The aim is that one client sending more than 50 requests per second can no longer empty the stage throttle (`custom.apiGatewayThrottling`, 50 rps per method), which every wallet route shares through `ANY /{proxy+}`, leaving every user with API Gateway's 429. WAF checks the rate about every 10 seconds, so a flood is cut off within seconds rather than at once.

The rule ships counting, not blocking (`custom.wafRuleAction: count`): it records the addresses over the cap and lets their requests through. Two things the AWS documentation leaves open decide whether blocking does any good:

- Which address the web ACL sees. The API is edge-optimized, so requests reach API Gateway through CloudFront, and AWS does not document whether a regional web ACL on such an API counts the client's address or the CloudFront edge's. If it is the edge's, the rule would lump many users under one address and block them together. Aggregating on `X-Forwarded-For` instead is not an option: a rate-based rule reads the first address in that header, which the client itself can write.
- Whether a request WAF blocks still takes a token from the stage throttle. AWS does not document the order of the two, so whether blocking keeps the throttle free for everyone else is unverified.

Cost per stage, from [AWS WAF pricing](https://aws.amazon.com/waf/pricing/): about USD 5 per web ACL per month, USD 1 per rule per month and USD 0.60 per million requests inspected, so roughly USD 6 a month per stage plus the request charge.

The GitHub deploy role needs WAF permissions before the first deploy that carries the web ACL; these are the actions CloudFormation's handlers for `AWS::WAFv2::WebACL` and `AWS::WAFv2::WebACLAssociation` call:

- `wafv2:CreateWebACL`, `UpdateWebACL`, `DeleteWebACL`, `GetWebACL`, `ListTagsForResource`, `TagResource` and `UntagResource` on `arn:aws:wafv2:us-east-1:<AWS_ACCOUNT_ID>:regional/webacl/gol-salmon-api-*/*`;
- `wafv2:AssociateWebACL`, `DisassociateWebACL` and `GetWebACLForResource` on that web ACL and on the stage, `arn:aws:apigateway:us-east-1::/restapis/*/stages/*`, since IAM checks both;
- `apigateway:SetWebACL` on the stage, which API Gateway requires both to attach and to remove a web ACL.

Without them the stack update fails and CloudFormation rolls it back. They belong in `aws-deploy-policy.json` (statements `WafWebAclForProject` and `WafAssociateStage`); the order to apply them in IAM is under [CI IAM permissions](#ci-iam-permissions). Staging is deployed by hand with the owner's own credentials, not with this role.

After the first deploy of each stage, check the association, then confirm the rule sees client addresses before it blocks anything:

```bash
aws wafv2 get-web-acl-for-resource --region us-east-1 \
  --resource-arn arn:aws:apigateway:us-east-1::/restapis/<api-id>/stages/<stage>
```

1. From one address you control, send staging more than 5 requests per second for a minute (for example a loop of `curl` against `GET /health` on the staging execute-api URL).
2. While it runs, list the addresses the rule is counting. Your own public address must appear, and no CloudFront address may (CloudFront's ranges are the `CLOUDFRONT` entries of `https://ip-ranges.amazonaws.com/ip-ranges.json`):
   ```bash
   aws wafv2 get-rate-based-statement-managed-keys --region us-east-1 --scope REGIONAL \
     --web-acl-name gol-salmon-api-<stage>-api --web-acl-id <web-acl-id> --rule-name per-ip-rate-limit
   ```
3. Cross-check in the sampled requests (AWS WAF console → the web ACL → Sampled requests, or `aws wafv2 get-sampled-requests` with the rule's metric name `per-ip-rate-limit`): the source IP of the counted requests must be the client's.

Only when both show client addresses, set `custom.wafRuleAction: block` in a follow-up change (and update the guard in `src/__tests__/prod-config.spec.js`), deploy staging, and repeat the load test: the loaded address must now get 403 from WAF while a second address still gets 200. If CloudFront addresses show up instead, leave the rule counting; per-client limiting then needs a different design.

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
- `config/env.staging.yml` — the same map pointed at `/salmon-api/staging/*`. To refresh staging after a prod param changes, copy that param to the staging path.
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

The GitHub Actions OIDC role's live policy is `GithubActionsPolicy` in AWS, and it is the policy this repository checks in as `aws-deploy-policy.json`: the attached version matches the file statement for statement (including `LambdaInvokeSanctionsRefresh`, which lets the deploy run `refreshSanctionsJob` once and nothing else), and the role additionally carries an inline `ReadSalmonApiProdParams` that lets it read `/salmon-api/prod/*` from SSM. Confirmed against the account on 2026-09-14. The deploy resolves every `${ssm:...}` ref with it: the `v0.14.0` tag deploy resolved every `${ssm:...}` ref and completed successfully. Keep any future tightening scoped to `ssm:GetParameter*` on that prefix.
