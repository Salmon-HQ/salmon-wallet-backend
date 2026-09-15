# Tasks: Community Powerups — backend contract

Ordered; each task leaves the suite green.

4. **Build service + errors**: `powerup-errors.js`, `powerup-build-service.build(id, query, locals)` with resolve → validate → adapter → compile → declared-program check → simulation check. Tests with a fixture adapter (jest.mock the registry).
5. **Docs**: root `AGENTS.md` — `community-powerups` contract bullet + "Contributing a Powerup" rule (contributors never touch this repo; maintainer adds registry entry/adapter; closed reason set; gate seam); nested `AGENTS.md` under `src/services/solana` and `src/routes/solana` mention the new folder/router; `CHANGELOG.md` Unreleased entry.
6. **Verify**: full gates + docker smoke per plan.md.
