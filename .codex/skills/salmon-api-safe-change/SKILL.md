---
name: salmon-api-safe-change
description: Safely modify or clean Salmon API without breaking active behavior. Use this skill for backend audits, dead-code removal, endpoint cleanup, Solana changes, consumer-sensitive refactors, or any task that should preserve existing contracts while verifying real usage and tests.
---

Operational workflow for safe backend changes in Salmon API. The contract and
consumer rules live in the root `AGENTS.md` ("Domain rules", "Spec contracts",
"Testing rules") — apply them as written; this skill only adds the change
process.

## Mandatory stance

- If a code graph / impact-analysis tool is available, treat it as support,
  not truth — corroborate findings against source before reporting or changing
  code (graphs reflect parse-time structure, not runtime behavior).
- Preserve public contracts, check the sibling frontend before removing
  surface, and treat Ethereum placeholders as intentional (see root
  `AGENTS.md` for the reasoning).

## Workflow

1. Build context
   - inspect code paths and current consumers
   - use a code graph if available, then verify in source
2. Establish baseline
   - run the smallest relevant backend tests before refactoring when practical
   - note current behavior and active callers
3. Change conservatively
   - prefer internal cleanup over public contract changes
   - remove dead code only after usage checks
4. Verify after change
   - rerun targeted backend tests
   - if the frontend consumes the touched contract, run the most relevant frontend tests too
5. Report residual risk
   - say what was verified
   - say what remains intentionally preserved

## Special rules

- For Solana transaction, burn, swap, or NFT changes, verify response shape and routing expectations.
- For provider integrations like Helius or Jupiter, preserve normalized app-facing outputs.
- If a dependency looks unused but supports a feature the team intentionally keeps for future work, leave it — and if intent is unclear, ask the human.

## What this skill should produce

- a conservative implementation plan
- explicit verification steps
- a final summary of what changed, what was tested, and what was intentionally left alone
