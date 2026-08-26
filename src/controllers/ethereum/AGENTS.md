# AGENTS.md instructions for `src/controllers/ethereum`

## Status

Skeleton. No Ethereum controllers yet.

## Responsibility (when implemented)

- expose Ethereum HTTP behavior
- translate Ethereum requests into backend service calls

## Rules

- Keep Ethereum controllers thin.
- Keep Ethereum behavior isolated from Bitcoin and Solana modules.
- If Ethereum domain logic grows, push it into dedicated services under
  `src/services/ethereum` rather than growing the controller.

## Testing

- Add controller tests once endpoints exist.
