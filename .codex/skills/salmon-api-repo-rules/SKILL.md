---
name: salmon-api-repo-rules
description: Resolve code placement, ownership, folder responsibility, and architecture boundaries in Salmon API. Use this skill whenever a task could change where backend code lives, whether logic belongs in routes/controllers/services/repositories/resources, whether something should stay Solana-local, or whether a new module belongs in `src/` versus `packages/`.
---

Placement and ownership workflow for Salmon API. The rules themselves are NOT
here — they live in the root `AGENTS.md` ("Placement rules", "Domain rules")
and in the nested `AGENTS.md` closest to the code you touch. Read those first;
this skill only adds the decision process.

## Mandatory stance

- Prefer existing repo patterns over inventing new structure.
- Search current modules before creating new helpers, services, or resources —
  duplicating an existing helper splits future fixes across two copies.
- If a placement decision could alter contracts or ownership, inspect current
  call sites first.
- If placement is still genuinely ambiguous after reading the relevant
  `AGENTS.md`, ask the human instead of guessing.

## Decision checklist

Before adding or moving code, answer:

- Is this HTTP wiring, business logic, data access, or response shaping?
- Is it domain-specific or genuinely cross-domain?
- Is it backend-specific, or reusable enough to justify `packages/`?
- Does it preserve current endpoint contracts?

## Audit mode

When asked to review structure, check for:

- business logic in controllers or routes
- response shaping happening inside services instead of resources
- Solana-only helpers placed in generic folders
- `utils` turning into a mixed catch-all
- modules under `packages/` that are actually backend feature code

## What this skill should produce

- a placement recommendation tied to current repo boundaries
- a concise explanation of why that location matches the architecture
- warnings when a proposed move would blur current folder responsibilities
