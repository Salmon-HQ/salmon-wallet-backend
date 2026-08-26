# AGENTS.md instructions for `src/routes`

## Responsibility

- register endpoint paths
- compose routers
- apply request middlewares
- delegate to controllers

## Rules

- Keep business logic out of routes.
- Keep payload shaping out of routes.
- New blockchain-specific routes should live in their matching subfolder when one exists.
- Cross-chain / chain-agnostic routers live in `shared/` (`bridge`, `coingecko`, `dapp`, `network`, `info`, plus the `network-route-path` helper). The folder root only holds subfolders.
- If a route needs branching or orchestration, push that down to a controller or service.

## Testing

- Add or update route/controller tests when route wiring changes behavior.
