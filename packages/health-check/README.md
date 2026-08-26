# @salmon/health-check

Health-probe helpers behind the `/health` endpoint: internet reachability, Redis probe, and the aggregate `UP`/`DOWN` verdict (a failed probe reports `DOWN` with a 500).

Internal package — consumed only by this repo. See the root `AGENTS.md` for what belongs in `packages/`.
