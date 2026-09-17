# Feature Specification: The verb inside an interaction

**Feature Branch**: `feat/powerups-foundations` (folder `017-interaction-actions`, stacked on 016)

**Created**: 2026-09-17 — **Status**: approved by the owner ("probemos lo que proponés")

## Context

Spec 016 made the legs true. Everything that is not a plain send or receive still says "Interaction", and the owner wants no row the user cannot read. Solana has no canonical tags; wallets derive them from the programs touched and from what moved. The backend already knows the program family (`source`) and now knows the net legs.

## Decisions (owner, 2026-09-17)

- The app name (Jupiter, Marinade, Magic Eden…) shows in the detail only, never in the row.
- Token accounts closed for their rent are not shown at all: the rent is in the balance, the row adds nothing the user needs explained. (They did add SOL — noted once; hidden by decision.)

## Requirements

- **FR-001** `action` on every `interaction`: `swap` (two assets on opposite sides, no NFT), `nft_sale` / `nft_purchase` (an NFT on one side), `accounts_closed` (SOL back, nothing else, closed accounts on the ledger, `actionMeta.count`), `program_call` (the rest). A stable key, translated by the client.
- **FR-002** `app` on any type when the program family has a name the user knows; absent for the platform's own programs and unknown ones.
- **FR-003** The service hides `accounts_closed` items and counts them in `meta.hidden`.
- **FR-004** Client: the row's verb is the action's ("Swapped", "NFT sold", "NFT bought"; "Interaction" for `program_call`), the subtitle for a swap names both assets; the detail shows an "App" row when `app` is present. Filters and icons keep reading `type`.
- **FR-005** Shape additive; older clients ignore the fields.

## Success

The 2026-08-17 Jupiter row reads "Swapped · USDC → SOL" with "App: Jupiter" in the detail; the three cleanups of 2026-09-14 are gone from the list and counted hidden; sends and receives unchanged.
