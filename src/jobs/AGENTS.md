# AGENTS.md instructions for `src/jobs`

## Responsibility

- async / scheduled processes that run outside the normal HTTP
  request/response loop
- entry points for `serverless.yml` Lambdas

## Files

- `handler.js` — the multi-job dispatcher. Hosts CoinGecko token-list
  refresh (hourly, bitcoin) and CoinGecko price refresh (rate-limited
  at 200 tokens per run). Handlers are platform-generic; the scheduled
  platforms live in `serverless.yml`.

## Rules

- Job entry points belong in this folder, NOT at `src/` root. The
  serverless wiring expects `src/jobs/<name>.handler`.
- Delegate business logic to `src/services/`. Jobs should be thin
  orchestration.
- Reuse repositories via `src/repositories/shared/` (or chain-specific
  sub-slices when the job touches one chain).
- Lambdas must be idempotent at the persistence layer — duplicate-safe
  inserts in the repository, cursor checkpoints in the job.

## Testing

- Tests live in `src/jobs/__tests__/`. Mock external providers
  (CoinGecko) and the repositories.
- Re-run the targeted job spec after touching the matching repository
  contract.
