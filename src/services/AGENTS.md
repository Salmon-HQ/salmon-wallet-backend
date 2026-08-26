# AGENTS.md instructions for `src/services`

## Responsibility

- own business logic
- coordinate providers and repositories
- define fallback and cache policy

## Rules

- Put orchestration here, not in controllers.
- Keep public response shaping in resources unless a helper is strictly internal.
- Domain-specific logic should stay near its domain slice when one exists.

## Testing

- New or changed service behavior should be covered with targeted service tests when practical.
