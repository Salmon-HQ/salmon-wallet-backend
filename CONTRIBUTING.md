# Contributing to salmon-api

Thanks for contributing. This document is the human-facing summary of the repo's working rules; the authoritative, always-current rule source is [`AGENTS.md`](AGENTS.md) (root plus the nested one closest to each folder) — if this file and `AGENTS.md` ever disagree, `AGENTS.md` wins.

## Getting started

- **Node 20** (the Lambda runtime is `nodejs20.x`; `package.json#engines` enforces `>=20`).
- **npm only.** `package-lock.json` is authoritative; install with `npm ci`. Do not add pnpm/yarn lockfiles.
- Local stack: `cp .env.example .env`, fill in values, then `docker-compose up` or `npm run serverless:start:local`. serverless-offline prefixes routes with the stage: local paths look like `/local/health`.

## Architecture in one paragraph

Layered Express/Serverless backend organized as vertical slices per blockchain (`bitcoin/`, `solana/`, `ethereum/` skeleton) plus `multichain/` and `shared/` slices. One job per layer: `routes` wire paths, `controllers` translate HTTP, `services` own business flow, `repositories`/`infrastructure` talk to data sources, `resources` shape public payloads. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before structural changes, and the API reference in [`docs/openapi.yaml`](docs/openapi.yaml) for endpoint contracts.

## Rules that will fail your PR if ignored

1. **Public contracts don't break silently.** The endpoints listed under "API contracts" in `AGENTS.md` are parsed by deployed wallet clients. Changing a response shape is a deliberate contract change: it needs tests, a consumer check, and a callout in the PR description.
2. **Test naming is enforced by CI.** All specs match `*.spec.js`. A suite that hits real services (Redis, live provider APIs) must be named `*.integration.spec.js` — CI runs `npm run test:unit` with no `.env`, no services, no secrets. Full guide: [`docs/TESTING.md`](docs/TESTING.md).
3. **Format and lint before you push.** `npm run format` (Prettier) and `npm run linter` (ESLint, auto-fix) fix locally; the PR gate runs the pure checks — `npm run format:check` and `npm run lint:check` (zero warnings) — and fails on any diff.
4. **Never commit secrets.** Not in code, config YAML, or docs. Prod secrets live only in AWS SSM Parameter Store. `.env` is gitignored and development-only.
5. **New dependencies need justification.** This backend serves a wallet: every dependency is supply-chain attack surface plus Lambda cold-start weight. Prefer existing code, then the Node stdlib, then an already-installed dependency, and only then a new package — justified in the PR description.

## Tests

- New behavior comes with tests at the nearest meaningful layer (service/resource/controller over full-suite runs).
- `npm run test:unit` — hermetic, runs on every PR. `npm run test:integration:hermetic` — docker-compose services only (Redis), also runs on every PR. `npm run test:integration` — hits live providers, needs a real `.env` locally; in CI it runs in the nightly workflow, never in the PR gate.

## Commits and PRs

- Conventional Commits: `<type>: <description>` with types `feat, fix, refactor, docs, test, chore, perf, ci`.
- **The PR title must be a conventional commit too** — CI validates it, and squash-merge makes the title the commit on `main`, so intermediate commits never reach the history.
- Keep PRs scoped; describe contract impact explicitly if any.

## Releases

Prod deploys are tag-triggered: push `prod/vX.Y.Z` from `main`. The tag must match `package.json#version` — bump it first or CI fails the deploy on purpose. Details: [`docs/DEPLOY.md`](docs/DEPLOY.md). Record user-visible changes in [`CHANGELOG.md`](CHANGELOG.md).

## License and contributions

This project is licensed under **Apache-2.0** (see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE)). Contributions are accepted under the **Contributor License Agreement** in [`CLA.md`](CLA.md): first-time contributors sign it once via the CLA bot on their first pull request. By contributing you also certify you have the right to submit the code under this license.

## Security issues

Never via public issues — see [`SECURITY.md`](SECURITY.md).
