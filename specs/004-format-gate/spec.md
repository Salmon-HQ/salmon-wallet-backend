# Spec 004 — Prettier format gate

Status: implemented in this branch.

## What

Prettier 3 with the same config as the frontend's `.prettierrc.json`
(semi, single quotes, width 100, es5 trailing commas), a one-shot
repo-wide `prettier --write .` (171 files), `format` / `format:check` npm
scripts, and a `Format check` step in `ci.yml`'s `checks` job.

Ignored beyond `.gitignore` (respected automatically by Prettier 3):
`package-lock.json` (machine-owned) and `docs/openapi.yaml` (contract
document — reformatting churns its diff history for zero benefit).

## Why

The repo is going public: formatting must be a machine's job, not a
reviewer note and not a style debate with an external contributor. The
frontend shipped the same gate; both repos now share one formatting
contract. ESLint here carries no stylistic rules, so there is no
Prettier/ESLint conflict to arbitrate.

## Alternatives discarded

- **Config without a CI gate** (the FE's original deferral): rejected by
  the maintainer — determinism for external PRs wins over avoiding the
  one-shot diff. The FE is adopting the gate as well.
- **husky/lint-staged pre-commit hook**: not added. CI is the contract;
  local hooks are optional convenience an external contributor may not
  have installed, and this repo currently has no hook infrastructure.
- **eslint-plugin-prettier**: runs Prettier as lint rules — slower, noisy
  diagnostics; the standalone `--check` is the documented recommendation.

## Verification criteria

- `npm run format:check` exits 0 on the branch.
- `npm run lint:check` still zero warnings after the rewrite (no
  formatting/lint conflict).
- `npm run test:unit` (777) and hermetic integration (7) green after the
  rewrite — formatting changed no behavior.
- CI `Format check` step green on this PR; a deliberately misformatted
  file would fail it (verified locally with `--check` before/after).
