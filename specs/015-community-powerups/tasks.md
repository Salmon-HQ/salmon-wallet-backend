# Tasks: Community Powerups — backend contract

Ordered; each task leaves the suite green.

1. **Extract the unsigned-transaction builder** from `solana-swap-build-service` into `src/services/solana/swap/unsigned-transaction-builder.js` (`resolvePriorityFee`, `simulate`, `computeUnitLimitFrom`, `fetchLookupTables`, `compileUnsigned`). Swap service delegates; `solana-swap-build-service.spec.js` unchanged and green.
2. **Stage config + capabilities**: add `powerups: { swap: { enabled: true } }` to the four `network-capabilities-<stage>.js`; `network-capabilities-service.getPowerups()` with validation (closed reason set, boolean `enabled`), `check()` skips `powerups`. Tests.
3. **Registry + catalog**: `registry.js` (swap entry), `powerup-catalog-service.listFor(networkId)`; `network-catalog-service` merges `powerups`; `network-resource` exposes it (`[]` default). Tests incl. a fixture registry with a disabled entry carrying a reason.
4. **Build service + errors**: `powerup-errors.js`, `powerup-build-service.build(id, query, locals)` with resolve → validate → adapter → compile → declared-program check → simulation check. Tests with a fixture adapter (jest.mock the registry).
5. **HTTP surface**: `powerup-gate.js` (no-op seam), `solana-powerups-router.js`, controller, resource; mount `/powerups` in `routes/solana/index.js`. Route test (404 for `swap`, 400 for bad publicKey). `signing-boundary.spec.js` passes untouched.
6. **Docs**: root `AGENTS.md` — `community-powerups` contract bullet + "Contributing a Powerup" rule (contributors never touch this repo; maintainer adds registry entry/adapter; closed reason set; gate seam); nested `AGENTS.md` under `src/services/solana` and `src/routes/solana` mention the new folder/router; `CHANGELOG.md` Unreleased entry.
7. **Verify**: full gates + docker smoke per plan.md.
