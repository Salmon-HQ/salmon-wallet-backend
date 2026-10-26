#!/usr/bin/env bash
#
# Runs `npm run test:integration` the way the nightly workflow does
# (.github/workflows/integration-external.yml): an empty Redis, and only the
# variables that job passes, with their values from the local .env.
# jest.setup.js loads .env for every variable left unset, so a plain local run
# sees keys the nightly lacks and can pass where the nightly fails; here every
# other .env name is set empty. Needs Docker for the throwaway Redis.
#
# Usage: ./scripts/integration-ci-env.sh [extra jest args]

set -euo pipefail
set +x
cd "$(dirname "$0")/.."

# Keep in step with the env block of the nightly's "Integration tests" step.
CI_VARS=(COINGECKO_API_KEY TRITON_RPC_URL TRITON_API_TOKEN ZEROEX_API_KEY JUPITER_API_KEY SWAP_FEE_BPS SWAP_FEE_ACCOUNT_OWNER)
PORT=6390

set -a
# shellcheck disable=SC1091
. ./.env
set +a
args=()
for name in $(grep -oE '^[A-Z_][A-Z0-9_]*=' .env | tr -d =); do args+=("$name="); done
for name in "${CI_VARS[@]}"; do args+=("$name=${!name:-}"); done

docker run --rm -d --name salmon-nightly-redis -p "$PORT:6379" redis:7-alpine >/dev/null
trap 'docker stop salmon-nightly-redis >/dev/null' EXIT
env -i PATH="$PATH" HOME="$HOME" "${args[@]}" REDIS_HOST=localhost REDIS_PORT="$PORT" \
  npm run test:integration -- "$@"
