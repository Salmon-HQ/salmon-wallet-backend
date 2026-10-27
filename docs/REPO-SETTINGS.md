# Repository settings runbook (maintainers)

GitHub settings that the repo's files reference but cannot enforce by
themselves. Everything below was applied on 2026-09-09 and is idempotent;
re-run a step if the UI ever drifts. Read state with the `GET` form of each
call. Every mutation needs repo **admin**.

## 1. Rulesets

Two active rulesets. Bypass is the **admin** role only (`actor_id: 5`,
`RepositoryRole`), so a non-admin collaborator cannot merge around them.

### `Protect main` (branch, `refs/heads/main`, bypass mode `pull_request`)

- **Require a pull request**: 1 approval, code-owner review, dismiss stale
  approvals on push, approval of the most recent reviewable push, all review
  threads resolved, **squash or merge commit**: a merge commit for the release
  PR from `staging`, so `main` shares its history; squash for an `exception`.
- **Required status checks** (strict: branch must be up to date):
  `lint / test / config`, `hermetic integration (redis)`,
  `workflow security lint`, `conventional PR title`,
  `local validator (v1 transactions)`. `mainnet v1 feature status` is
  schedule-only and deliberately not required.
- **Require code scanning results**: CodeQL, security alerts `high_or_higher`,
  other alerts `errors`. OpenSSF Scorecard also uploads SARIF (tool
  "Scorecard", `.github/workflows/scorecard.yml`) but is deliberately not a
  required tool: its findings are advisory and must never block a merge.
- **Block force pushes**, **block deletion**. Linear history is not required,
  because the release PR from `staging` lands as a merge commit.

### `Protect staging` (branch, `refs/heads/staging`)

- **Block deletion** and **block force pushes**. Auto-delete of head branches
  (section 2) would otherwise delete `staging` when its release PR merges.

### `Protect prod tags` (tag, `refs/tags/prod/*`, bypass mode `always`)

A `prod/vX.Y.Z` tag triggers the production deploy
(`.github/workflows/deploy.yml`), so tag creation is the real deploy
permission. **Creation, update, deletion and force-update are blocked for
everyone except admins.** Without this ruleset, anyone with push could deploy
to prod without a PR.

Read both: `gh api repos/Salmon-HQ/salmon-wallet-backend/rulesets` and
`.../rulesets/<id>`; update with `PUT .../rulesets/<id>` and the same JSON
shape the GET returns.

## 2. Merge settings

The `conventional PR title` check exists because a squash merge takes the PR
title as its commit. PRs into `staging` are squash-merged; the release PR from
`staging` to `main` is merged with a merge commit (`docs/DEPLOY.md`).

Applied: squash ON (commit title = PR title, message = PR body), merge
commits ON, rebase OFF, auto-delete head branches ON (`staging` is kept by its
ruleset).

```bash
gh api -X PATCH repos/Salmon-HQ/salmon-wallet-backend \
  -F allow_squash_merge=true -F allow_merge_commit=true -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F squash_merge_commit_title=PR_TITLE \
  -F squash_merge_commit_message=PR_BODY
```

Admins merge a PR into `staging` with `gh pr merge <n> --squash` and the
release PR with `gh pr merge <n> --merge --admin`.

## 3. Code security (all free on a public repo)

Applied: **CodeQL default setup** (languages `javascript-typescript` +
`actions`, `default` query suite), **secret scanning**, **push protection**,
**Dependabot security updates** (separate from the weekly version updates in
`.github/dependabot.yml`), **private vulnerability reporting** (the channel
`SECURITY.md` points to).

```bash
R=repos/Salmon-HQ/salmon-wallet-backend
gh api $R/code-scanning/default-setup                   # state, languages, suite
gh api -X PATCH $R/code-scanning/default-setup \
  -f state=configured -f query_suite=default \
  -f 'languages[]=javascript-typescript' -f 'languages[]=actions'
gh api $R --jq .security_and_analysis                   # scanning toggles
gh api $R/private-vulnerability-reporting --jq .enabled
```

CodeQL triage notes: dismiss false positives on the Security tab **with a
written reason** (they stay dismissed while the flagged lines are unchanged).
Known ones: the caller-URL fetch in `dapp-service.js` (the
feature; `dapp-url-guard.js` is the control), the `arweeve` typo fix in
`content-urls.js`. CodeQL does not recognise a `Set#has` lookup as a
prototype-pollution sanitizer; guard `__proto__` / `constructor` /
`prototype` with direct `===` comparisons.

## 4. OpenSSF Scorecard

`.github/workflows/scorecard.yml` runs on push to `main`, weekly, and on
ruleset changes, and publishes to https://api.scorecard.dev (`publish_results:
true`, OIDC-verified). Badge and per-check detail:
https://scorecard.dev/viewer/?uri=github.com/Salmon-HQ/salmon-wallet-backend.
Preview locally before relying on the number:

```bash
brew install scorecard
GITHUB_AUTH_TOKEN="$(gh auth token)" scorecard \
  --repo=github.com/Salmon-HQ/salmon-wallet-backend --show-details
```

Ceilings worth knowing: Branch-Protection tops out at 9 while any bypass
actor exists (admin bypass forces `EnforceAdmins=false`); Code-Review counts
approvals by someone other than the author, so admin self-merges score 0;
Packaging / Signed-Releases are N/A (no releases) and excluded from the
aggregate; Maintained is 0 until the repo is 90 days old.

## 5. Actions secrets for the nightly integration workflow

The external-provider integration suite (nightly workflow, separate from PR
checks) needs real provider keys: `COINGECKO_API_KEY`, `TRITON_RPC_URL`,
`TRITON_API_TOKEN`, `ZEROEX_API_KEY`, `JUPITER_API_KEY`, plus the repository
variables `SWAP_FEE_BPS` and `SWAP_FEE_ACCOUNT_OWNER` (public values) so the
swap suites assert the fee leg. Fork PRs never see these — the PR workflow uses
plain `pull_request` and no secrets.

The keys are environment secrets of the `provider-tests` environment, not
repository secrets: a repository secret reaches any workflow a collaborator
pushes on any branch, while an environment secret reaches only jobs the
environment's deployment-branch rule admits. The job also runs only on
`refs/heads/main`, so a manual dispatch on another branch skips it. One-time
setup (Settings → Environments, or the commands below), done before the change
that adds `environment: provider-tests` to the workflow is merged: a job that
names an environment which does not exist yet creates it with no branch rule,
and until step 1 is done a workflow edited on another branch could reach the
keys through it.

1. Create the environment `provider-tests` with deployment branches limited to
   the selected branch `main`:
   ```bash
   gh api -X PUT repos/Salmon-HQ/salmon-wallet-backend/environments/provider-tests \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/Salmon-HQ/salmon-wallet-backend/environments/provider-tests/deployment-branch-policies \
     -f name=main -f type=branch
   ```
2. Add the five keys as secrets of that environment
   (`gh secret set <NAME> --env provider-tests`, which prompts for the value).
3. Delete the repository-level copies
   (`gh secret delete <NAME>`), so no other workflow can read them.

Until step 3, the job still reads the repository copies; after it, a run
outside `main` gets no key at all.

The same workflow's `production country gate` job needs no secrets: it calls
prod's public `GET /status` and `GET /v1/solana-mainnet/powerups/availability`.
The optional repository variable `PROD_API_URL` points it at another base URL;
unset, it uses the prod execute-api URL.

## 6. The `production` environment (deploy role)

The deploy job runs as the `production` environment, and `GithubActionsRole`
trusts that environment. A job without an environment is identified by its git
ref, and the monthly scheduled redeploy runs from `main` rather than from a
`prod/*` tag, so a role that trusted only the tags refused it. The environment
admits the branch `main` and the tags `prod/*` and nothing else. It has no
required reviewer, because the monthly run is unattended.

Done before the change that adds `environment: production` to `deploy.yml`
reaches `main`: a job that names an environment which does not exist yet
creates it with no branch rule.

1. Create the environment with deployment branches and tags limited to `main`
   and `prod/*`:
   ```bash
   gh api -X PUT repos/Salmon-HQ/salmon-wallet-backend/environments/production \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/Salmon-HQ/salmon-wallet-backend/environments/production/deployment-branch-policies \
     -f name=main -f type=branch
   gh api -X POST repos/Salmon-HQ/salmon-wallet-backend/environments/production/deployment-branch-policies \
     -f name='prod/*' -f type=tag
   ```
2. Let the role's trust policy accept the environment's subject,
   `repo:Salmon-HQ@296841509/salmon-wallet-backend@1347383970:environment:production`
   (the repository uses GitHub's immutable subject prefix, read with
   `gh api repos/Salmon-HQ/salmon-wallet-backend/actions/oidc/customization/sub`),
   next to the tag subject `…:ref:refs/tags/prod/*`, which keeps a rerun of a
   deploy made before this change working. Drop the tag subject once a deploy
   with the environment has passed.

## 7. Who can push

The repo is public, so anyone can fork and open a PR, but only collaborators
can push branches and only admins can bypass the rulesets or create a
`prod/*` tag. Review the collaborator list periodically:
`gh api repos/Salmon-HQ/salmon-wallet-backend/collaborators --jq '.[] | "\(.login) \(.role_name)"'`.
