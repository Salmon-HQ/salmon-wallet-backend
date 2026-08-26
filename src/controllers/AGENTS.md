# AGENTS.md instructions for `src/controllers`

## Responsibility

- read request input
- call the right service
- return HTTP responses

## Rules

- Keep controllers thin.
- Cross-chain / chain-agnostic controllers live in `shared/` (`bridge`, `coingecko`, `dapp`, `network`, `info`). The folder root only holds subfolders.
- Do not embed provider logic, cache policy, or multi-step business flow here.
- Put response contract shaping in resources when the payload is public and structured.

## Testing

- Add or update controller tests when request parsing, status codes, or response contracts change.
