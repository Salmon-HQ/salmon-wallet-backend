# Feature Specification: Capability availability — where a Powerup may be offered

**Feature Branch**: `011-capability-availability`

**Created**: 2026-09-14

**Status**: Draft — owner decisions below taken 2026-09-14; the build hold on the Powerups stack still stands

**Input**: Owner: "a generic gate, not a swap one — a capability must not appear as installable where it cannot be used, and someone who installed it at home and travels should be told when they open it, not when their transaction fails"

> The referenced-but-never-written spec 011. `specs/010-signing-boundary`,
> `specs/012-swap-v2-build` and `specs/015-community-powerups` all point
> here for region gating; this document is what they point at.

## The property

**A capability is offered only where it may be offered, and the wallet says
so before the user starts rather than after they finish.**

Nothing here decides _which_ countries. It decides how the answer travels and
where it is enforced, so that the day counsel names a country the change is a
configuration edit, not a release.

## Owner decisions (2026-09-14)

1. **Availability is backend policy, never a manifest field.** A manifest
   ships inside a binary: withdrawing a country would then wait for a release
   and for users to update, which is the one thing a withdrawal cannot wait
   for. Server policy takes effect on the next call, for everyone.
2. **The first list is a denylist of embargoed territories** — Cuba, Iran,
   North Korea, Syria, and the Crimea, Donetsk and Luhansk regions. It needs
   no legal opinion, and it is what 0x's licence obliges Salmon to stand
   behind. The positive per-country allowlist is a later phase and waits for
   counsel (see `specs/012-swap-v2-build` User Story 3).
3. **An unresolved country is not a restricted one.** The gate fails open on a
   lookup failure: a denylist that cannot resolve an address has not found an
   embargo, and failing closed would take every capability down worldwide
   whenever one lookup service is unwell.

## What already exists, and is not to be rebuilt

Established by reading both repositories on 2026-09-14:

- The reason code already travels end to end. `getPowerupCatalog` takes
  `disabledReasons` typed `'region' | 'maintenance' | 'deprecated'`, and both
  client twins already render "not available in your region" from it.
- `GET /v1/networks` already publishes, per network, `powerups: [{ id,
enabled, reason? }]`, assembled from the per-stage capability config.
- The client already maps `403 region_restricted` and `403 wallet_restricted`
  to an unavailable state with a reason.
- `powerupGate` already exists as the single seam, mounted on
  `GET /powerups/:id/build`.

What is missing is only the per-viewer answer, its enforcement on every build
route, and one shared surface to render it.

## Three facts that constrain the design

1. **The network catalog is cached at the edge for an hour**, and
   `specs/015-community-powerups` states that per-request region must never
   leak into it. Availability therefore cannot ride on that response; it needs
   its own, uncached one.
2. **`GET /ft/swap/build` has no gate mounted at all.** The seam covers the
   generic Powerup route only, so a gate built there alone would leave the one
   capability that is actually built ungated.
3. **`geo-service.js` is unwired and resolves without the caller's address**,
   so it answers for the server rather than the caller. It is a starting point
   to fix, not a working component to mount.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A capability is not offered where it cannot be used (Priority: P1)

Someone opens the catalogue in a restricted territory. The capability appears
with its reason, not as an install waiting to disappoint. Nothing about the
catalogue's own cached response changes.

**Acceptance Scenarios**:

1. **Given** a caller in a restricted territory, **When** the wallet asks for
   availability, **Then** the capability comes back disabled with reason
   `region`, and the catalogue renders the reason it already knows how to
   render.
2. **Given** a caller anywhere else, **When** the wallet asks, **Then** every
   capability the stage offers comes back enabled.
3. **Given** the network catalog is served from cache, **When** two callers in
   different countries fetch it, **Then** both receive the same bytes: the
   catalogue stays region-agnostic and availability is the separate answer.

### User Story 2 - The traveller is told on arrival, not on failure (Priority: P1)

Someone installs a capability at home and opens it in a restricted territory.
The screen says the capability is unavailable there and will work on return.
No form is filled, no quote is requested, nothing fails.

**Acceptance Scenarios**:

1. **Given** an installed capability and a restricted territory, **When** the
   user opens its screen, **Then** the unavailable state renders before any
   build request is made.
2. **Given** the same user back home, **When** the screen is opened, **Then**
   it works, with no reinstall and no setting to restore.

### User Story 3 - The build refuses, whichever route it arrives on (Priority: P1)

The gate is the backstop, not the door: the two checks above are client state,
and client state goes stale and can be forged.

**Acceptance Scenarios**:

1. **Given** a restricted territory, **When** a build is requested on
   `GET /powerups/:id/build`, **Then** `403 region_restricted`, and no
   provider is called.
2. **Given** a restricted territory, **When** a build is requested on
   `GET /ft/swap/build`, **Then** the same refusal on the same terms.
3. **Given** a request whose country cannot be resolved, **When** a build is
   requested, **Then** it proceeds, and the failure to resolve is logged.
4. **Given** a request that did not arrive through the edge, **When** any
   build is requested, **Then** it is refused before the country is read at
   all — a country a caller can set is not a country.

### User Story 4 - One unavailable surface, not one per capability (Priority: P2)

Today only Swap has an unavailable screen, and Memo renders it by borrowing
Swap's translation key. A capability should not have to copy another's copy.

**Acceptance Scenarios**:

1. **Given** any capability and any unavailable reason, **When** its screen
   renders, **Then** it uses the shared surface with its own name in it.
2. **Given** Memo, **When** it is unavailable, **Then** no string from Swap's
   locale block is read.

## Requirements _(mandatory)_

- **FR-001**: The backend MUST expose the caller's availability separately
  from the network catalog, uncached, as `{ id, enabled, reason? }` per
  capability, with `reason` from the existing vocabulary.
- **FR-002**: The caller's country MUST be resolved at the edge and passed to
  the origin, and the origin MUST refuse a request that did not arrive through
  the edge. A country supplied by the caller MUST never be trusted.
- **FR-003**: `powerupGate` MUST be mounted on every route that builds a
  transaction, `GET /ft/swap/build` included, and MUST answer
  `403 region_restricted` before any provider call.
- **FR-004**: The gate MUST treat an unresolved country as unrestricted, and
  MUST log the failure to resolve.
- **FR-005**: The client MUST merge the availability answer into the
  `disabledReasons` the catalogue already accepts. No new catalogue UI is
  required and none should be built.
- **FR-006**: A capability's own screen MUST read the same availability answer
  before it renders its working state.
- **FR-007**: One shared unavailable surface MUST serve every capability, and
  no capability may read another's translation keys.
- **FR-008**: Availability MUST be decided per request. The backend MUST NOT
  persist a country, a capability's state per wallet, or anything else per
  user.
- **FR-009**: Wallet screening stays the routing provider's. The backend
  renders its refusal as `wallet_restricted` and MUST NOT maintain a sanctions
  list of its own.

## What this gate is not

It is not evidence of the licensing App Review asks for, and it is not the
identity-corroborated geo-block the United Kingdom's financial regulator
describes as good practice — a wallet with no accounts cannot cross-check an
address against a verified identity, by design. Describing it as either
overstates it, in a place where overstating is expensive.

It is also not a wall. Someone determined to reach a capability from a
restricted territory can. The gate states where Salmon offers the capability;
it does not pretend to make the network unreachable.

## Out of scope

- The positive per-country allowlist and the legal opinion that would justify
  one — `specs/012-swap-v2-build` User Story 3, Phase B.
- Sanctions screening of addresses, which the routing provider performs.
- Anything that would make a stale client refuse on its own: the answer comes
  from the backend on every call, which is what makes a withdrawal immediate.
