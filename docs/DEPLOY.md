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

Each artifact carries the country database of the deploy that built it. That database is DB-IP's edition of the 1st of the month the artifact was deployed in (of the month before, for a deploy early on the 1st), so check the target's timestamp before rolling back: once its database is more than 45 days old, prod places nobody and Swap closes everywhere. Never roll back to an artifact older than 0.26.0 without the owner: those place a caller whose country is unknown as unrestricted and carry a looser built-in table. Never roll back past the release that adds the Lambda role's permissions boundary either ([CI IAM permissions](#rollout-order)): the rollback would strip the boundary and every later CI deploy would fail. After a rollback the newest `prod/v*` tag is still the release that was rolled back, and the monthly run on the 2nd redeploys it; before the 2nd, push a fix as a new tag or delete the bad tag so the newest one is the release now running.

`concurrency: deploy-prod` (`cancel-in-progress: false`) prevents two tags pushed close together from deploying in parallel.

Three stages exist: `local` (dev, no AWS), `prod` (tag-triggered deploy), and `staging`.

`staging` is a mirror of `prod` for testing a branch before it ships: stack `gol-salmon-api-staging`, params under `/salmon-api/staging/*`, capabilities in `network-capabilities-staging.js` (the Powerups under test are on there and off in prod). It is deployed by hand from the branch under test, never by CI:

```bash
eval "$(aws configure export-credentials --format env)"   # Serverless v3 does not read an `aws login` session
npm run serverless:deploy:staging
```

The script first runs `node scripts/refresh-geo-data.mjs`, so staging ships the month's DB-IP country database like prod; a failed download stops it before anything is deployed. It then runs `refreshSanctionsJob` once. Swap screening reads the sanctions list from Redis and only that daily job fills it, so a fresh or emptied Redis would otherwise block every swap for up to a day. A failed refresh prints a warning and leaves the deploy in place.

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

- `config/env.prod.yml` — the `${ssm:/salmon-api/prod/X}` refs consumed by `serverless.yml` via `custom.envFile`, laid out as one map per function (`api`, `coingeckoJob`, `sanctionsJob`, `skrJob`, `events`) built from shared groups (`redis`, `resilience`, `coingecko`, `triton`) merged with `<<`. Each Lambda receives only its own map, so a function never holds a credential its code does not read; `src/__tests__/prod-config.spec.js` pins which secrets each map may hold. Vars that previously had an `${env:X, <default>}` fallback keep a matching `${ssm:X, <default>}` fallback, so an optional/missing param doesn't break a deploy. Vars that were previously required (no default) stay strict and fail the deploy loudly if the param is missing.
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
2. New var: add it to the map (or group) of every function that reads it in `config/env.prod.yml` (`${ssm:/salmon-api/prod/YOUR_VAR}`), `config/env.staging.yml` and `config/env.local.yml` (`${env:YOUR_VAR, ''}`), and to the `PARAM_NAMES` list in `scripts/ssm-put-params.sh`.
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

The GitHub Actions OIDC role (`GithubActionsRole`) deploys with the customer managed policy `GithubActionsPolicy`, which this repository checks in as `aws-deploy-policy.json` (`LambdaInvokeSanctionsRefresh` lets the deploy run `refreshSanctionsJob` once and nothing else). The role also carries an inline `ReadSalmonApiProdParams` that lets it read `/salmon-api/prod/*` from SSM, which the deploy needs to resolve every `${ssm:...}` ref; keep any tightening of that one scoped to `ssm:GetParameter*` on that prefix. The policy is close to IAM's limit of 6,144 characters for a managed policy (white space not counted), so a large addition needs a second managed policy on the role.

### The Lambda role's permissions boundary

The Lambda role of each stage (`gol-salmon-api-<stage>-us-east-1-lambdaRole`) carries the managed policy `gol-salmon-api-lambda-boundary` (`aws-lambda-permissions-boundary.json`) as its permissions boundary (`provider.iam.role.permissionsBoundary` in `serverless.yml`). Whatever policy is put on the role, it can only write its own log groups and read the availability table parameter, and nothing in IAM. The functions read no other parameter at runtime: every other value reaches them as an environment variable at deploy time. A feature that reads another parameter, or calls another AWS service, at runtime needs the boundary widened first.

`aws-deploy-policy.json` holds the deploy role to that boundary:

- it may create, change or delete a `gol-salmon-api-*` role, its inline policies, attached policies or trust policy only while that role carries `gol-salmon-api-lambda-boundary` (`iam:PermissionsBoundary` condition), and set no other boundary;
- it may pass `gol-salmon-api-*` roles only to Lambda (`iam:PassedToService`);
- it may never remove a boundary or edit, roll back or delete the boundary policy (explicit denies);
- it may create, update, delete or change-set only the `gol-salmon-api-*` stacks. A stack with a service role runs under that role, not the caller's, so write access to every stack in the account would be access to every role a stack carries.

So a compromised deploy job can no longer create an administrator role. What it can still do: IAM has no condition key on the contents of a trust policy, so it could make a bounded project role trust another account, which then gets only what the boundary allows. `iam:UpdateAssumeRolePolicy` stays allowed on bounded roles because CloudFormation's handler for `AWS::IAM::Role` lists it among the permissions its updates may use; whether a deploy that leaves the trust policy unchanged calls it is unverified.

To change the boundary, edit `aws-lambda-permissions-boundary.json` and publish it with administrator credentials (the deploy role is denied this):

```bash
ACCOUNT_ID=<AWS_ACCOUNT_ID>
sed "s/<AWS_ACCOUNT_ID>/$ACCOUNT_ID/g" aws-lambda-permissions-boundary.json > /tmp/lambda-boundary.json
aws iam create-policy-version --set-as-default \
  --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/gol-salmon-api-lambda-boundary" \
  --policy-document file:///tmp/lambda-boundary.json
```

### Rollout order

Applying the restrictive `aws-deploy-policy.json` before a deploy has attached the boundary to the Lambda role breaks every deploy: CloudFormation could no longer update a role that carries no boundary. The first rollout therefore runs in three steps, in this order, with administrator credentials (`aws login`). Every command uses the account id placeholder the rest of this repository uses.

Ship the boundary in a release of its own (release A) and the web ACL in the next one (release B): when a deploy that sets the boundary fails, CloudFormation rolls back by removing it again, and a release that changes only the role keeps that rollback small and easy to read.

**Step 1 — create the boundary policy and add only what the next deploys need.** This is additive: the live `GithubActionsPolicy` keeps working unchanged, and a temporary inline policy adds setting the boundary on project roles, removing it again (only our boundary, so a failed release A can roll back), and the WAF permissions release B needs (statements `WafWebAclForProject` and `WafAssociateStage`).

```bash
ACCOUNT_ID=<AWS_ACCOUNT_ID>
sed "s/<AWS_ACCOUNT_ID>/$ACCOUNT_ID/g" aws-lambda-permissions-boundary.json > /tmp/lambda-boundary.json
aws iam create-policy --policy-name gol-salmon-api-lambda-boundary \
  --description "Ceiling for the gol-salmon-api Lambda roles" \
  --policy-document file:///tmp/lambda-boundary.json

jq '{Version, Statement: [(.Statement[] | select(.Sid == "WafWebAclForProject" or .Sid == "WafAssociateStage")), (.Statement[] | select(.Sid == "IamWriteOnlyWithBoundary") | .Sid = "IamSetProjectRoleBoundary" | .Action = ["iam:PutRolePermissionsBoundary", "iam:DeleteRolePermissionsBoundary"])]}' \
  aws-deploy-policy.json | sed "s/<AWS_ACCOUNT_ID>/$ACCOUNT_ID/g" > /tmp/deploy-step1.json
aws iam put-role-policy --role-name GithubActionsRole \
  --policy-name SalmonApiBoundaryAndWaf --policy-document file:///tmp/deploy-step1.json
```

**Step 2 — release A, then the checks.** Merge the change and push its `prod/vX.Y.Z` tag ([Release, step by step](#release-step-by-step)); the deploy attaches the boundary to the prod Lambda role. Deploy staging the same way, by hand, so its role carries the boundary too. Then check three things before step 3:

```bash
# 1. Every project role carries the boundary. Delete a leftover role, or put the boundary on it,
#    before step 3: the deploy role may still pass any gol-salmon-api-* role to a Lambda function,
#    so an unbounded leftover would be a way around the boundary.
aws iam list-roles \
  --query "Roles[?starts_with(RoleName,'gol-salmon-api-')].[RoleName,PermissionsBoundary.PermissionsBoundaryArn]" \
  --output table
# 2. Which stacks run under a service role. No gol-salmon-api-* stack should; the others are the
#    ones the deploy role can no longer update.
aws cloudformation describe-stacks --region us-east-1 --query 'Stacks[?RoleARN].[StackName,RoleARN]' --output table
# 3. The live deploy policy is the one this repository last recorded, so step 3 drops nothing
#    someone added by hand. Compare it with aws-deploy-policy.json from before this change.
DEFAULT=$(aws iam get-policy --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/GithubActionsPolicy" \
  --query 'Policy.DefaultVersionId' --output text)
aws iam get-policy-version --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/GithubActionsPolicy" \
  --version-id "$DEFAULT" --query 'PolicyVersion.Document' > /tmp/live-deploy-policy.json
git show <commit-before-this-change>:aws-deploy-policy.json | sed "s/<AWS_ACCOUNT_ID>/$ACCOUNT_ID/g" > /tmp/previous-deploy-policy.json
diff <(jq -S . /tmp/live-deploy-policy.json) <(jq -S . /tmp/previous-deploy-policy.json)
```

Any difference in the third check is a permission added outside the repository: carry it into `aws-deploy-policy.json`, or confirm it is no longer needed, before step 3.

**Step 3 — apply the restrictive policy and drop the temporary one.** A managed policy keeps at most five versions; when `list-policy-versions` shows five, delete the oldest non-default one first.

```bash
ACCOUNT_ID=<AWS_ACCOUNT_ID>
aws iam list-policy-versions --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/GithubActionsPolicy"
# only when five versions exist:
aws iam delete-policy-version --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/GithubActionsPolicy" --version-id <oldest-non-default>

sed "s/<AWS_ACCOUNT_ID>/$ACCOUNT_ID/g" aws-deploy-policy.json > /tmp/deploy-policy.json
aws iam create-policy-version --set-as-default \
  --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/GithubActionsPolicy" \
  --policy-document file:///tmp/deploy-policy.json
aws iam delete-role-policy --role-name GithubActionsRole --policy-name SalmonApiBoundaryAndWaf
```

Check the result without deploying. With no boundary in the request, creating a project role must come back `implicitDeny`; passing a project role to Lambda `allowed`; with our boundary in the request, changing the Lambda role's inline policy `allowed` and removing its boundary `explicitDeny`:

```bash
BOUNDARY="ContextKeyName=iam:PermissionsBoundary,ContextKeyValues=arn:aws:iam::$ACCOUNT_ID:policy/gol-salmon-api-lambda-boundary,ContextKeyType=string"
ROLE="arn:aws:iam::$ACCOUNT_ID:role/gol-salmon-api-prod-us-east-1-lambdaRole"
SOURCE="arn:aws:iam::$ACCOUNT_ID:role/GithubActionsRole"
aws iam simulate-principal-policy --policy-source-arn "$SOURCE" \
  --action-names iam:CreateRole --resource-arns "arn:aws:iam::$ACCOUNT_ID:role/gol-salmon-api-check" \
  --query 'EvaluationResults[].EvalDecision'
aws iam simulate-principal-policy --policy-source-arn "$SOURCE" \
  --action-names iam:PassRole --resource-arns "$ROLE" \
  --context-entries "ContextKeyName=iam:PassedToService,ContextKeyValues=lambda.amazonaws.com,ContextKeyType=string" \
  --query 'EvaluationResults[].EvalDecision'
aws iam simulate-principal-policy --policy-source-arn "$SOURCE" \
  --action-names iam:PutRolePolicy --resource-arns "$ROLE" --context-entries "$BOUNDARY" \
  --query 'EvaluationResults[].EvalDecision'
aws iam simulate-principal-policy --policy-source-arn "$SOURCE" \
  --action-names iam:DeleteRolePermissionsBoundary --resource-arns "$ROLE" --context-entries "$BOUNDARY" \
  --query 'EvaluationResults[].EvalDecision'
```

Release B (the web ACL) can follow once step 2's checks pass; the restrictive policy carries the WAF permissions too.

If the next deploy fails on an IAM permission, roll step 3 back by making the previous version the default again (`aws iam set-default-policy-version --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/GithubActionsPolicy" --version-id <previous>`) and re-run the `put-role-policy` of step 1.

Never roll back past release A, the release that adds the boundary. `serverless rollback` with administrator credentials would deploy a template without the boundary and remove it from the Lambda role, after which every CI deploy fails (the deploy role may change only bounded roles); a CI deploy of an older tag fails on the role straight away, since removing the boundary is denied.
