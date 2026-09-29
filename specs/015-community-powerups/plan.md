# Implementation Plan: Community Powerups — backend contract

**Branch**: `015-community-powerups` (stacked on 014) | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

## Summary

A Salmon-maintained Powerup registry, a per-stage enable/reason config, a
`powerups` array on every network in `/v1/networks`, and one generic
`GET /powerups/:id/build` route under the Solana chain slice that turns a
registered adapter's instructions into an UNSIGNED v0 transaction through
simulation), refusing any transaction that reaches a program the Powerup
did not declare. A `powerupGate` middleware is the seam for spec 011.

## Technical Context

Node 24, Express 5, `@solana/web3.js` 1.99 beta (v0 messages, lookup
tables), Jest 30. Reused as-is: `network-capabilities-<stage>.js` loading in
`network-capabilities-service`, `network-catalog-service` +
simulation / lookup-table helpers (extracted, behaviour unchanged),
`providerCall` for any upstream an adapter calls, the error middleware
(`statusCode` + `errorCode`), `signing-boundary.spec.js` (GET route, no
allowlist entry; controller denylist applies).

## Design

```
src/services/solana/powerups/
│                            # entry: { tier, networks, contributor: {name,url}|null, endpoints?: string[], programIds?: string[], adapter?: { validate(query) → {params}|{error,error_description}, build(params, ctx) → { instructions, lookupTableAddresses?, salmonFee?, display: {...typed} } } }
├── powerup-catalog-service.js  # listFor(networkId) → [{ id, enabled, reason? }]: registry ∩ stage config ∩ entry.networks; reason only when disabled
└── powerup-errors.js           # PowerupError(message, statusCode, errorCode)
src/network-capabilities/network-capabilities-<stage>.js
src/services/shared/network-capabilities-service.js
                             # + getPowerups(): raw `powerups` block of the stage file, validated (unknown reason / non-boolean enabled → loud error + undefined → catalog 503, same posture as a bad NODE_ENV); `check()` skips the `powerups` key
src/services/shared/network-catalog-service.js   # merge adds powerups: powerupCatalog.listFor(network.id)
src/resources/shared/network-resource.js         # + powerups: network.powerups || []
src/middlewares/powerup-gate.js                  # (req, res, next) → next(); header comment: spec 011 seam (region + sanctions); logs nothing yet
src/routes/solana/solana-powerups-router.js      # GET /:id/build → powerupGate → controller.build  (mounted at /powerups in routes/solana/index.js)
src/controllers/solana/solana-powerups-controller.js  # publicKey required + valid address; delegates; [POWERUP_BUILD] log { id, network, outcome }
src/resources/solana/solana-powerup-build-resource.js # { transaction, expiresAt, provider, providerDisplayName, attribution, salmonFee, routeFee: null, contributor, priorityFeeMicroLamports, computeUnitLimit, ...display }
```

client's proposal mapper is reused; `contributor` is the registry entry's.
No fee plumbing beyond pass-through of an adapter-supplied `salmonFee`
path with the first real transaction-building Powerup.

## Deviations from spec

- `salmonFee` is forced null on the generic route: no adapter-reported fee
  is published. Fee legs land with the first Powerup that has one and will
- The declared-program check runs on the COMPILED v0 message with lookup
  tables resolved (`compileUnsigned` returns `programIds`; ComputeBudget is
  an explicit member of the allowed set); an adapter may only name lookup
  tables in the entry's `lookupTables`. Simulation transport failures are
  503 `simulation_unavailable`, not 422.
- `listFor(networkId)` also honours the network's stage `enable` flag and
  the build route resolves through the same predicate (`isOffered`).
- Placement: `registry.js` + `powerup-catalog-service.js` live under
  `src/services/solana/powerups/` for now; they may move to
  `src/services/shared/powerups/` when a second chain needs them.
- `powerupGate` logs nothing; `[POWERUP_BUILD]` is logged by the controller
  (id, network, outcome) so the gate stays a pure seam.

## Verification

- Unit: registry + catalog (fixture registry via `jest.mock`), capabilities
  `getPowerups` validation (bad reason → undefined + console.error), network
  resource carries `powerups: []` on networks without any, build service
  with a fixture adapter: happy path (unsigned v0, payer = caller, declared
  programs), undeclared program → 502, simulation error → 422, unknown /
- `npm run test:unit`, `lint:check`, `format:check`, `serverless print`.
