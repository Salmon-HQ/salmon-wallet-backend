# Spec 001 — Deterministic PR checks (`ci.yml`)

Status: implemented in this branch. Mirrors
`salmon-wallet-frontend/specs/008-ci-pr-checks` adapted to this repo (plain
JS — no typecheck; npm — no pnpm/turbo; single package; serverless).

## What

A `CI` workflow that runs on every `pull_request` and on `push` to `main`,
with four jobs:

1. **`lint / test / config`** — `npm ci`, `npm run lint:check` (new script:
   `eslint ./ --max-warnings 0`, pure check, no `--fix`), `npm run
test:unit` (774 tests, ~5 s), and `npx serverless print --stage local >
/dev/null` as a credential-free smoke that `serverless.yml` still
   resolves (same check `deploy.yml`'s verify job runs at tag time — here it
   moves to PR time).
2. **`hermetic integration (redis)`** — the curated hermetic integration
   set (today: `packages/redis-connector/index.integration.spec.js`) against
   a `redis:7-alpine` service container, via the new
   `test:integration:hermetic` script with `REDIS_HOST=localhost`. The other
   five integration specs hit real providers (Helius/Jupiter/Triton/RPC) and
   are excluded by design: flaky, rate-limited, secret-needing — they belong
   to the nightly workflow (spec 003, later batch).
3. **`conventional PR title`** — `amannn/action-semantic-pull-request`,
   types `feat fix refactor docs test chore perf ci` (exactly the set in
   this repo's history and the FE's). With squash-only merges the PR title
   IS the commit on `main`, so this replaces commitlint-on-commits entirely.
4. **`workflow security lint`** — zizmor, so the workflows themselves stay
   reviewable by machine (template injection, unpinned actions, credential
   persistence).

Supporting changes: `.nvmrc` (20 — matches the Lambda runtime `nodejs20.x`
and `deploy.yml`), deletion of the dead legacy `.eslintrc.js` (ignored by
ESLint 9 flat config), `.github/zizmor.yml` ignores for the frozen
`deploy.yml`/`test-aws.yml` findings (documented in that file),
`docs/REPO-SETTINGS.md` (branch ruleset, squash-only, required checks).

## Why

The repo is going public with external PRs reviewed by AI agents. Every
deterministic failure a machine can catch before review is scope removed
from the reviewer, whose context should be spent only on logic, security,
design, and contract impact. Today nothing runs on PRs at all — lint and
tests first execute at deploy-tag time, after merge.

## Security model

- Plain `pull_request`, never `pull_request_target`: fork runs get no
  secrets by construction.
- `permissions: {}` at workflow level; each job grants its own minimum.
- Every action pinned to a full commit SHA with a version comment.
- `persist-credentials: false` on every checkout — nothing in CI pushes.
- `serverless print` output discarded (`> /dev/null`); the `local` stage
  resolves `${env:X, ''}` to empty strings with no `.env`, so nothing
  secret exists to leak. The `serverless:print` npm script
  (`--stage prod -v`) must never be wired into a workflow — it would dump
  resolved SSM SecureStrings.

## Alternatives discarded

- **commitlint on commits** — redundant under squash-only merges; also
  commitlint 21 requires Node ≥ 22.12 while this repo tracks the Lambda
  runtime (Node 20). PR-title check chosen (cal.com / turborepo pattern).
- **Running all 6 integration specs in the PR gate** — five hit live
  providers; four of those have guards that a dummy env value satisfies, so
  they fail on DNS/401 or silently assert nothing without a real `.env`
  (fixed in a separate test-hygiene batch). External providers in a PR gate
  = flakiness + rate-limit burn + secrets exposed to fork PRs.
- **Coverage threshold** — deliberately none (mirrors FE decision D7): a
  global number punishes refactors and does not measure test quality.
  Reviewer judges coverage of new code.
- **SHA-pinning `deploy.yml`/`test-aws.yml` in this batch** — those
  workflows are frozen (they encode real incident lessons); zizmor findings
  on them are config-ignored with reasons, pending a deliberate hardening
  pass.

## Verification criteria

- Local, before push: `npm run lint:check` exit 0 with zero warnings;
  `npm run test:unit` green; `npm run test:integration:hermetic` green
  against the docker-compose redis; `uvx zizmor .github/workflows/` reports
  no findings.
- In CI: all four jobs green on this branch's own PR; total wall time
  under 10 minutes (expected < 4).
- After merge: apply `docs/REPO-SETTINGS.md` (required checks + squash-only)
  so the gates actually gate.
