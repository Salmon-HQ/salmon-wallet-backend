# Instructions for GitHub Copilot

The canonical rule source for any AI agent working in this repo is [`AGENTS.md`](../AGENTS.md) (root, plus the nested one closest to each folder — the closest one wins). Read it before making changes.

Non-negotiables it covers: layer placement rules, public API contracts (breaking them fails review), test hermeticity and naming (enforced by CI), secrets policy, and the testing policy in `docs/TESTING.md`.
