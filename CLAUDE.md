@AGENTS.md

`AGENTS.md` (root plus the nested one closest to each folder) is the canonical
rule source for every agent and tool. Nothing in this file or under `.claude/`
overrides it.

Claude-specific pointers:

- read `docs/ARCHITECTURE.md` before structural changes
- `.claude/agents/repo-architect.md` — placement and boundary decisions
- `.claude/agents/safe-backend-auditor.md` — contract-safe cleanup, consumer checks, verification planning
- `.claude/skills/` — on-demand runbooks: `deploy-runbook`, `solana-rpc-context`
