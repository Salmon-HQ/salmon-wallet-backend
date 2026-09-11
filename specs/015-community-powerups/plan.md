# Implementation Plan: Community Powerups — backend contract

**Branch**: `015-community-powerups` (stacked on 014) | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

## Summary

A Salmon-maintained Powerup registry, a per-stage enable/reason config, a
`powerups` array on every network in `/v1/networks`, and one generic
`GET /powerups/:id/build` route under the Solana chain slice that turns a
registered adapter's instructions into an UNSIGNED v0 transaction through
the same compile step the swap uses (priority fee, compute-unit limit,
simulation), refusing any transaction that reaches a program the Powerup
did not declare. A `powerupGate` middleware is the seam for spec 011.
Swap stays on `/ft/swap/build`; the registry lists it for the catalog only.

## Technical Context

Node 24, Express 5, `@solana/web3.js` 1.99 beta (v0 messages, lookup
tables), Jest 30. Reused as-is: `network-capabilities-<stage>.js` loading in
`network-capabilities-service`, `network-catalog-service` +
`network-resource` (`/v1/networks`), the swap build's priority-fee /
simulation / lookup-table helpers (extracted, behaviour unchanged),
`providerCall` for any upstream an adapter calls, the error middleware
(`statusCode` + `errorCode`), `signing-boundary.spec.js` (GET route, no
allowlist entry; controller denylist applies).

## Design

```
src/services/solana/powerups/
├── registry.js              # POWERUPS = { swap: { tier: 'core', networks: ['solana-mainnet'], contributor: null, endpoints: [] } }
│                            # entry: { tier, networks, contributor: {name,url}|null, endpoints?: string[], programIds?: string[], adapter?: { validate(query) → {params}|{error,error_description}, build(params, ctx) → { instructions, lookupTableAddresses?, salmonFee?, display: {...typed} } } }
├── powerup-catalog-service.js  # listFor(networkId) → [{ id, enabled, reason? }]: registry ∩ stage config ∩ entry.networks; reason only when disabled
├── powerup-build-service.js    # build(id, query, locals): resolve (404 not_found for unknown / disabled / no adapter / network mismatch / 'swap') → adapter.validate (400) → adapter.build → compileUnsigned → assertDeclaredPrograms (502 provider_program_mismatch, [POWERUP_PROGRAM_MISMATCH]) → simulation.err → 422 simulation_failed → result
└── powerup-errors.js           # PowerupError(message, statusCode, errorCode)
src/services/solana/swap/unsigned-transaction-builder.js
                             # extracted from solana-swap-build-service: resolvePriorityFee, simulate, computeUnitLimitFrom, fetchLookupTables, compileUnsigned({ connection, payer, instructions, lookupTableAddresses, cleanup }) → { transaction, priorityFeeMicroLamports, computeUnitLimit, simulation }
                             # swap service calls it; its tests stay green unchanged
src/network-capabilities/network-capabilities-<stage>.js
                             # + powerups: { swap: { enabled: true } }   (reason ∈ {region, maintenance, deprecated}, only when enabled: false)
src/services/shared/network-capabilities-service.js
                             # + getPowerups(): raw `powerups` block of the stage file, validated (unknown reason / non-boolean enabled → loud error + undefined → catalog 503, same posture as a bad NODE_ENV); `check()` skips the `powerups` key
src/services/shared/network-catalog-service.js   # merge adds powerups: powerupCatalog.listFor(network.id)
src/resources/shared/network-resource.js         # + powerups: network.powerups || []
src/middlewares/powerup-gate.js                  # (req, res, next) → next(); header comment: spec 011 seam (region + sanctions); logs nothing yet
src/routes/solana/solana-powerups-router.js      # GET /:id/build → powerupGate → controller.build  (mounted at /powerups in routes/solana/index.js)
src/controllers/solana/solana-powerups-controller.js  # publicKey required + valid address; delegates; [POWERUP_BUILD] log { id, network, outcome }
src/resources/solana/solana-powerup-build-resource.js # { transaction, expiresAt, provider, providerDisplayName, attribution, salmonFee, routeFee: null, contributor, priorityFeeMicroLamports, computeUnitLimit, ...display }
```

Response envelope mirrors `solana-swap-build-resource` field names so the
client's proposal mapper is reused; `contributor` is the registry entry's.
No fee plumbing beyond pass-through of an adapter-supplied `salmonFee`
(none exists yet); the swap's recipient resolution moves to the generic
path with the first real transaction-building Powerup.

## Deviations from spec

- Fee policy reuse (`SWAP_FEE_BPS` recipient resolution) is a pass-through
  hook, not wired: no adapter reports a fee leg yet. Recorded in AGENTS.md.
- `powerupGate` logs nothing; `[POWERUP_BUILD]` is logged by the controller
  (id, network, outcome) so the gate stays a pure seam.

## Verification

- Unit: registry + catalog (fixture registry via `jest.mock`), capabilities
  `getPowerups` validation (bad reason → undefined + console.error), network
  resource carries `powerups: []` on networks without any, build service
  with a fixture adapter: happy path (unsigned v0, payer = caller, declared
  programs), undeclared program → 502, simulation error → 422, unknown /
  disabled / read-only / `swap` → 404, param error → 400.
- Swap build spec unchanged and green after the extraction.
- `npm run test:unit`, `lint:check`, `format:check`, `serverless print`.
- Docker: `GET /local/v1/networks` shows `powerups: [{ id: 'swap', enabled: true }]` on `solana-mainnet`, `[]` elsewhere; `GET /local/v1/solana-mainnet/powerups/swap/build` → 404 `not_found`.
