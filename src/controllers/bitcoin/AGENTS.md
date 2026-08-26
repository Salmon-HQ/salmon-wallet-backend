# AGENTS.md instructions for `src/controllers/bitcoin`

## Responsibility

- expose Bitcoin account HTTP behavior
- translate Bitcoin requests into backend service calls

## Rules

- Keep Bitcoin controllers thin.
- Keep Bitcoin behavior isolated from Solana-specific modules.
- If Bitcoin domain logic grows, prefer pushing that into dedicated services rather than growing the controller.

## Testing

- Update controller tests when Bitcoin params, status codes, or response shape change.
