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
  threads resolved, **squash merge only**.
- **Required status checks** (strict: branch must be up to date):
  `lint / test / config`, `hermetic integration (redis)`,
  `workflow security lint`, `conventional PR title`,
  `local validator (v1 transactions)`. `mainnet v1 feature status` is
  schedule-only and deliberately not required.
- **Require code scanning results**: CodeQL, security alerts `high_or_higher`,
  other alerts `errors`. OpenSSF Scorecard also uploads SARIF (tool
  "Scorecard", `.github/workflows/scorecard.yml`) but is deliberately not a
  required tool: its findings are advisory and must never block a merge.
- **Require linear history**, **block force pushes**, **block deletion**.

### `Protect prod tags` (tag, `refs/tags/prod/*`, bypass mode `always`)

A `prod/vX.Y.Z` tag triggers the production deploy
(`.github/workflows/deploy.yml`), so tag creation is the real deploy
permission. **Creation, update, deletion and force-update are blocked for
everyone except admins.** Without this ruleset, anyone with push could deploy
to prod without a PR.

Read both: `gh api repos/Salmon-HQ/salmon-wallet-backend/rulesets` and
`.../rulesets/<id>`; update with `PUT .../rulesets/<id>` and the same JSON
shape the GET returns.

## 2. Merge settings (squash only)

The `conventional PR title` check exists because the PR title becomes the
commit on `main`. That only holds with squash merges.

Applied: squash ON (commit title = PR title, message = PR body), merge
commits OFF, rebase OFF, auto-delete head branches ON.

```bash
gh api -X PATCH repos/Salmon-HQ/salmon-wallet-backend \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F squash_merge_commit_title=PR_TITLE \
  -F squash_merge_commit_message=PR_BODY
```

Admins merge with `gh pr merge <n> --squash --admin`.

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
Known ones: the referral-account log in `solana-ft-swap-service.js` (public
address, not a secret), the caller-URL fetch in `dapp-service.js` (the
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
checks) needs real provider keys as repository secrets: `HELIUS_API_KEY`,
`JUPITER_API_KEY` (optional), `TRITON_RPC_URL`, `TRITON_API_TOKEN`. Fork PRs
never see these — the PR workflow uses plain `pull_request` and no secrets.

## 6. Who can push

The repo is public, so anyone can fork and open a PR, but only collaborators
can push branches and only admins can bypass the rulesets or create a
`prod/*` tag. Review the collaborator list periodically:
`gh api repos/Salmon-HQ/salmon-wallet-backend/collaborators --jq '.[] | "\(.login) \(.role_name)"'`.
