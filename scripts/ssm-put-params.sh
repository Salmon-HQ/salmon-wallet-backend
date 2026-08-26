#!/usr/bin/env bash
#
# Seeds AWS SSM Parameter Store (/salmon-api/prod/*) so `config/env.prod.yml`
# can resolve its ${ssm:...} refs at deploy time. See docs/DEPLOY.md.
#
# Source-of-truth priority per param:
#   1. The LIVE prod Lambda's env vars (`aws lambda get-function-configuration`
#      on gol-salmon-api-prod-api) — what's actually running in prod today.
#   2. Local `.env`, ONLY as a fallback for params missing on the live Lambda
#      (expected: GA4_MEASUREMENT_ID, GA4_API_SECRET — new, never deployed).
# Local `.env` is NOT a general source: it intentionally diverges from prod
# (dev-safe values, cost/blast-radius reasons), so seeding SSM from it wholesale
# would push dev values into prod. After this one-time seed, SSM is the single
# source of truth for prod — edit params directly (see docs/DEPLOY.md), not .env.
#
# Usage:
#   ./scripts/ssm-put-params.sh              # dry-run (default): prints NAMES only
#   ./scripts/ssm-put-params.sh --dry-run    # same, explicit
#   ./scripts/ssm-put-params.sh --execute    # actually writes to SSM
#
# Never echoes values. `set +x` enforced — do not remove.

set -euo pipefail
set +x

DRY_RUN=true
for arg in "$@"; do
  case "$arg" in
    --execute) DRY_RUN=false ;;
    --dry-run) DRY_RUN=true ;;
    *)
      echo "Unknown argument: $arg (expected --dry-run or --execute)" >&2
      exit 1
      ;;
  esac
done

REGION="us-east-1"
FUNCTION_NAME="gol-salmon-api-prod-api"
SSM_PREFIX="/salmon-api/prod"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

# Vars config/env.prod.yml resolves via ${ssm:...}. Excludes STAGE (inline
# self-reference), GITHUB_SHA/GITHUB_RUN_ID (CI-injected), ANALYTICS_SINK/
# ANALYTICS_FILE_PATH (literals in env.prod.yml), and the RATE_LIMIT_* group
# (ssm refs with safe defaults — seed them only to override the defaults).
PARAM_NAMES=(
  NODE_ENV
  SERVICE_NAME
  REDIS_HOST
  REDIS_PORT
  REDIS_PASSWORD
  REDIS_CONNECT_TIMEOUT
  REDIS_RECONNECT_MAX_RETRIES
  REDIS_FAIL_FAST_LAPSE
  JUPITER_PRICE_URL
  JUPITER_SWAP_URL
  JUPITER_API_KEY
  JUPITER_SWAP_REFERRAL_ACCOUNT
  JUPITER_SWAP_REFERRAL_FEE_BPS
  COINGECKO_API_KEY
  STEALTHEX_URL
  SOLANA_FALLBACK_MAX_RPS
  TRITON_RPC_URL
  TRITON_RPC_URL_DEVNET
  HELIUS_API_KEY
  UBIQUITY_API_KEY
  STEALTHEX_API_KEY
  GA4_MEASUREMENT_ID
  GA4_API_SECRET
)

echo "== ssm-put-params: $([ "$DRY_RUN" = true ] && echo DRY-RUN || echo EXECUTE) (${#PARAM_NAMES[@]} params) ==" >&2

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "ERROR: aws sts get-caller-identity failed — check AWS credentials." >&2
  exit 1
fi

# Pull the live Lambda's current env vars once (kept in memory only, never
# echoed or logged as a whole).
LIVE_ENV_JSON="$(aws lambda get-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --query 'Environment.Variables' \
  --output json)"

# Looks up one key in the live-Lambda JSON blob. Exits 1 (no stdout) if the
# key is absent so callers can fall through to the next source.
get_live_value() {
  node -e '
    const data = JSON.parse(process.argv[1] || "{}");
    const value = data[process.argv[2]];
    if (value === undefined || value === null) process.exit(1);
    process.stdout.write(String(value));
  ' "$LIVE_ENV_JSON" "$1"
}

# Looks up one key in .env, splitting on the FIRST "=" only so values
# containing "=" stay intact. Strips one layer of matching surrounding
# quotes. Exits 1 (no stdout) if the file or key is absent.
get_dotenv_value() {
  [ -f "$ENV_FILE" ] || return 1
  node -e '
    const fs = require("fs");
    const target = process.argv[2];
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key !== target) continue;
      let value = trimmed.slice(eq + 1);
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === "\"" && last === "\"") || (first === "\x27" && last === "\x27")) {
        value = value.slice(1, -1);
      }
      process.stdout.write(value);
      process.exit(0);
    }
    process.exit(1);
  ' "$ENV_FILE" "$1"
}

written=0
skipped=0

for name in "${PARAM_NAMES[@]}"; do
  value=""
  source=""
  if value="$(get_live_value "$name")" && [ -n "$value" ]; then
    source="live-lambda"
  elif value="$(get_dotenv_value "$name")" && [ -n "$value" ]; then
    source=".env-fallback"
  else
    echo "WARN: $name missing/empty on live Lambda and .env — skipping (SSM rejects empty values)" >&2
    skipped=$((skipped + 1))
    continue
  fi

  param_name="${SSM_PREFIX}/${name}"
  if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] would write ${param_name} (source: ${source})"
  else
    aws ssm put-parameter \
      --name "$param_name" \
      --type SecureString \
      --value "$value" \
      --overwrite \
      --region "$REGION" >/dev/null
    echo "wrote ${param_name} (source: ${source})"
  fi
  value=""
  written=$((written + 1))
done

echo "== ${written} params $([ "$DRY_RUN" = true ] && echo 'would be written' || echo 'written'), ${skipped} skipped ==" >&2
if [ "$DRY_RUN" = true ]; then
  echo "Re-run with --execute to actually write to SSM." >&2
fi
