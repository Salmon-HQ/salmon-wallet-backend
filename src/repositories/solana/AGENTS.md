# AGENTS.md instructions for `src/repositories/solana`

## Responsibility

- provide Solana-specific repository access patterns and data lookups

## Rules

- Keep Solana data-access logic here, not in controllers.
- Avoid pushing high-level transaction, burn, or swap orchestration into repositories.
- Keep constants and source-specific access close to the Solana repository layer.

## Testing

- Update repository tests when Solana source behavior or repository contracts change.
