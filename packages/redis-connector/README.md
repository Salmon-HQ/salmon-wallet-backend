# @salmon/redis-connector

Redis client factory with connection lifecycle logging, lazy connect with promise coalescing, and reconnection handling. Every Redis access in the repo goes through this connector (via `src/repositories/data-source.js`).

Internal package — consumed only by this repo. See the root `AGENTS.md` for what belongs in `packages/`.
