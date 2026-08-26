# AGENTS.md instructions for `src/controllers/multichain`

## Responsibility

- expose HTTP behavior for endpoints that work across more than one blockchain
- translate cross-chain requests into `src/services/multichain` calls

## Rules

- Keep controllers thin; never embed provider logic, cache policy, or fallback policy here.
- Resolve the active chain from `res.locals.network.blockchain` rather than from request input.
- If a controller is only used by one chain in practice, move it under that chain's controller folder.

## Testing

- Update controller tests when request parsing or response contracts change.
