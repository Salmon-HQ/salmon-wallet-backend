# Repository settings runbook (maintainers)

GitHub settings that the repo's files reference but cannot enforce by
themselves. Apply after the CI workflow (`.github/workflows/ci.yml`) has
landed on `main`, so the required checks exist. Everything here is idempotent
and takes effect immediately.

## 1. Branch protection for `main` (ruleset)

Without this, CODEOWNERS is decorative, force-pushes to `main` are possible,
and CI is advisory. Settings → Rules → Rulesets → New branch ruleset:

- **Target**: `main` (include default branch), enforcement **Active**.
- **Require a pull request before merging**: 1 approval, **Require review
  from Code Owners** ON, dismiss stale approvals ON.
- **Require status checks to pass**: add `lint / test / config`,
  `hermetic integration (redis)`, `conventional PR title`,
  `workflow security lint`. Require branches to be up to date: OFF (solo
  maintainer; turn on if the repo gains write collaborators).
- **Block force pushes** and **Restrict deletions**: ON.

Note: the tag-triggered deploy (`prod/v*`) is unaffected — rulesets here
target branches, not tags.

## 2. Squash-only merges

The `conventional PR title` check exists because the PR title becomes the
commit on `main`. That only holds with squash merges.

Settings → General → Pull Requests:

- Allow squash merging: ON, default commit message **Pull request title**.
- Allow merge commits: OFF. Allow rebase merging: OFF.
- Automatically delete head branches: ON (keeps the branch list clean).

## 3. Private vulnerability reporting

When the repo goes public, verify it is actually enabled: Settings →
Advanced Security → **Private vulnerability reporting** ON. (It is not
automatic on public repos.) Also enable **Secret scanning** and **Push
protection** there — free on public repos.

## 4. Actions secrets for the nightly integration workflow

The external-provider integration suite (nightly workflow, separate from PR
checks) needs real provider keys as repository secrets: `HELIUS_API_KEY`,
`JUPITER_API_KEY` (optional), `TRITON_RPC_URL`, `TRITON_API_TOKEN`. Fork PRs
never see these — the PR workflow uses plain `pull_request` and no secrets.
