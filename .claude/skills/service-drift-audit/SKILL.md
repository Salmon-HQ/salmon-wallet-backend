---
name: service-drift-audit
description: Checks salmon-api's external service dependencies (Jupiter, Helius, Triton, Metaplex, spl-token, Node/Lambda runtime) for documentation or API drift against a recorded baseline, classifies findings, and stops for human review on breaking changes. ALWAYS use for requests like "check for service updates", "audit our API dependencies", "did Jupiter/Helius/Metaplex change anything", or similar drift-check requests.
---

# Service Drift Audit — salmon-api

Manual invocation today; written to be cron-ready later (see bottom). No
automation is wired up yet — running this skill is the whole audit.

## Watchlist & baseline (as of 2026-07-30)

### Jupiter Swap

- On the unified `api.jup.ag/swap/v2` endpoints (`order`/`execute`). The
  older `ultra`/`v1` surface is deprecated with no announced shutdown date.
- Pricing structure is in transition; Price v3 is current (see
  `src/services/solana/jupiter-service.js`).
- Sources: dev.jup.ag/updates, developers.jup.ag/docs/swap, portal.jup.ag.

### Helius

- DAS provider in a fallback role (Triton is primary — see below).
- `helius-sdk` v3 is kit-native.
- Sources: helius.dev/docs, github.com/helius-labs.

### Triton

- Primary RPC + DAS provider. Implements Helius's DAS spec.
- Gaps: no Enhanced Transactions API; `getLargestAccounts` is throttled on
  the current plan.
- Source: docs.triton.one.

### Metaplex

- On Umi (web3.js v1 transitive dependency — accepted, not a drift signal
  on its own).
- Watch triggers — only these change our architecture:
  - (a) an official `mpl-bubblegum-kit` published on npm.
  - (b) `@metaplex-foundation/mpl-token-metadata-kit` reaches a real minor
    with burn/transfer documented and tested (currently `0.0.3` pre-alpha;
    README states "transaction sending not yet implemented").
- Sources: npm, github.com/metaplex-foundation, and the Metaplex skill repo
  (`skills/metaplex/references`, installable via
  `npx skills add metaplex-foundation/skill` per
  `.claude/skills/solana-rpc-context/SKILL.md`).

### @solana/spl-token + spl-token-registry

- `spl-token-registry` is deprecated upstream. Watch for security advisories
  on both packages (`npm audit`, GitHub advisories).

### Node runtime

- `engines` in `package.json` requires `>=20.0.0`; Lambda runtime is
  `nodejs20.x` in `serverless.yml` (see `.claude/skills/deploy-runbook/SKILL.md`).
- Watch AWS Lambda runtime deprecation notices for `nodejs20.x`.

## Procedure

For each service in the watchlist:

1. Fetch the source-of-truth URL(s) listed above.
2. Diff what you find against the baseline text in this file.
3. Classify each finding:
   - **INFO** — no action needed. Note it in your report; no code or file
     changes.
   - **ACTION** — small, scoped change (e.g. a version bump, a doc link
     update, a new advisory to note). Propose a minimal fix; do not sprawl
     beyond the drifted item.
   - **BREAKING** — STOP. Do not modify code. Report the finding to the
     human with evidence (URL, quoted text, version numbers). Wait for a
     decision.
4. If any audit lands code or doc changes, update the corresponding
   baseline bullet(s) above in the same change, including the "as of" date
   in the heading.

## Cron-ready

This skill is stateless beyond the baseline recorded in this file — no
external state store, no scripts. That makes it safe to invoke on a
schedule later (e.g. a weekly cron agent run) without extra wiring: the
only persistent state to diff against is the baseline text above, and the
only side effect on a clean run is updating that text.
