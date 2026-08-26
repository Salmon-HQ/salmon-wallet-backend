# Spec 003 — External-provider integration workflow (nightly)

Status: implemented in this branch. Depends on spec 002 (suites must skip
with a reason instead of hard-failing when a provider is unconfigured).

## What

`integration-external.yml`: runs `npm run test:integration` (all 6 suites,
`--runInBand`) against live providers, daily (`cron: 17 6 * * *`) and on
`workflow_dispatch`. Redis service container for the suites that touch the
cache path. Provider credentials come from repository secrets
(`HELIUS_API_KEY`, `JUPITER_API_KEY`, `TRITON_RPC_URL`, `TRITON_API_TOKEN`);
public Jupiter endpoint URLs are plain env values. Same hardening as
`ci.yml`: SHA-pinned actions, `permissions: {}` + per-job `contents: read`,
`persist-credentials: false`, no `pull_request` trigger of any kind — fork
PRs can never reach these secrets because the workflow never runs in PR
context.

While secrets are not yet loaded, the probes from spec 002 make each suite
skip with a logged reason, so the workflow lands green and gains coverage
as ops adds each secret (list documented in `docs/REPO-SETTINGS.md`).

## Why

These suites are the only automated check of the real provider contracts
(`solana-transaction-enrichment` provider routing, Jupiter Ultra shapes,
Triton RPC/DAS). In the PR gate they would be flakiness + rate-limit burn +
a secret-exposure surface; on a schedule they are a drift detector. A red
nightly is a maintainer signal, never a merge blocker.

## Alternatives discarded

- **Folding `test-aws.yml` (OIDC smoke) into this workflow**: kept separate.
  It tests AWS deploy credentials, not data providers; merging them would
  give the provider job `id-token: write` for no reason and make a provider
  flake look like an AWS auth problem. It stays manual-only.
- **Per-suite matrix jobs**: one job is enough at 6 suites / ~25 s wall
  time; a matrix would multiply npm ci time for no isolation benefit.
- **Retries on provider failures**: explicitly rejected — a provider that
  needs retries to pass is exactly the signal this workflow exists to
  surface.

## Known state at merge time

`triton-provider` suite will fail (or skip, if `TRITON_RPC_URL` is not
loaded) until the Triton plan question is resolved: the endpoint answers
`getHealth` but returns `-32601 Method not found` for
`getTransactionsForAddress` (verified 2026-08-12 against the live endpoint
with the documented request shape). Production currently works because the
resolver falls back to Helius on that error, but that makes Triton dead
weight as primary — ops follow-up documented in spec 002.

## Verification criteria

- zizmor clean.
- Workflow lands on `main`, then a `workflow_dispatch` run completes:
  suites without secrets skip with logged reasons; nothing hard-fails for
  configuration reasons.
- PR-gate jobs unaffected (workflow has no `pull_request` trigger).
