#!/usr/bin/env bash
#
# Rotates one provider credential everywhere the backend reads it: SSM
# (/salmon-api/prod and /salmon-api/staging), the GitHub `provider-tests`
# environment of the nightly integration workflow, and the local .env.
# See docs/DEPLOY.md "Adding or rotating a secret".
#
# The new value comes from the clipboard (pbpaste) or, without one, a hidden
# prompt. It is never printed and never placed on a command line. One
# read-only call to the provider must accept it before anything is written.
# Output shows only 8-character SHA-256 prefixes ("fingerprints").
#
# Usage:
#   ./scripts/rotate-provider-key.sh NAME            # rotate NAME
#   ./scripts/rotate-provider-key.sh NAME --check    # test the value in SSM prod, change nothing
#   ./scripts/rotate-provider-key.sh NAME --verify   # after deploys: fingerprint in SSM and every Lambda
#
# NAME: JUPITER_API_KEY, ZEROEX_API_KEY, COINGECKO_API_KEY, TRITON_RPC_URL,
#       TRITON_RPC_URL_DEVNET, SOLANA_PUBLIC_RPC_URL_MAINNET

set -euo pipefail
set +x

NAME="${1:?usage: $0 NAME [--check|--verify]}"
MODE="${2:-}"
REGION=us-east-1
REPO=Salmon-HQ/salmon-wallet-backend
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
# The nightly integration workflow reads these from the provider-tests environment.
CI_NAMES=" COINGECKO_API_KEY TRITON_RPC_URL ZEROEX_API_KEY JUPITER_API_KEY "

fp() { printf '%s' "$1" | shasum -a 256 | cut -c1-8; }
ssm_get() {
  aws ssm get-parameter --region "$REGION" --with-decryption --name "/salmon-api/$1/$2" \
    --query Parameter.Value --output text 2>/dev/null || true
}

# One read-only call that only a working value passes; prints 200 on success.
check() {
  local value="$1" host header
  case "$NAME" in
    JUPITER_API_KEY)
      curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H @<(printf 'x-api-key: %s\n' "$value") \
        'https://api.jup.ag/swap/v2/build?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000&taker=86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY'
      ;;
    ZEROEX_API_KEY)
      curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H @<(printf '0x-api-key: %s\n' "$value") \
        'https://api.0x.org/solana/enabled-sources'
      ;;
    COINGECKO_API_KEY)
      # The backend's host and header (from COINGECKO_API_URL). /ping answers 401 to a
      # wrong key, while price and token-list endpoints still answer 200 to one.
      case "$(ssm_get prod COINGECKO_API_URL)" in
        *pro-api*) host=https://pro-api.coingecko.com header=x-cg-pro-api-key ;;
        *) host=https://api.coingecko.com header=x-cg-demo-api-key ;;
      esac
      curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H @<(printf '%s: %s\n' "$header" "$value") \
        "$host/api/v3/ping"
      ;;
    TRITON_RPC_URL | TRITON_RPC_URL_DEVNET | SOLANA_PUBLIC_RPC_URL_MAINNET)
      # The URL carries the token, so it goes to curl through a config file, not argv.
      if curl -s --max-time 15 -H 'content-type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' -K <(printf 'url = "%s"\n' "$value") |
        grep -q '"result"'; then echo 200; else echo failed; fi
      ;;
    *)
      echo "no check for $NAME" >&2
      return 1
      ;;
  esac
}

if [ "$MODE" = "--check" ]; then
  echo "$NAME in SSM prod ($(fp "$(ssm_get prod "$NAME")")): $(check "$(ssm_get prod "$NAME")")"
  exit 0
fi

if [ "$MODE" = "--verify" ]; then
  for stage in prod staging; do
    echo "SSM $stage: $(fp "$(ssm_get "$stage" "$NAME")")"
    for fn in $(aws lambda list-functions --region "$REGION" --output text \
      --query "Functions[?starts_with(FunctionName, 'gol-salmon-api-$stage-')].FunctionName"); do
      value="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn" \
        --query "Environment.Variables.$NAME" --output text)"
      [ "$value" = "None" ] || echo "  $fn: $(fp "$value")"
    done
  done
  exit 0
fi

if command -v pbpaste >/dev/null; then
  NEW="$(pbpaste | tr -d '[:space:]')"
else
  read -rsp "New value for $NAME: " NEW
  echo
fi
[ "${#NEW}" -ge 20 ] || { echo "No value found: copy the new $NAME and run again."; exit 1; }
OLD="$(ssm_get prod "$NAME")"
[ "$NEW" != "$OLD" ] || { echo "That value is already in SSM prod."; exit 1; }
echo "New $NAME $(fp "$NEW"), current $(fp "$OLD")"

status="$(check "$NEW")"
echo "Test call with the new value: $status"
[ "$status" = 200 ] || { echo "Stopped: nothing was changed."; exit 1; }

for stage in prod staging; do
  [ -n "$(ssm_get "$stage" "$NAME")" ] || continue
  aws ssm put-parameter --region "$REGION" --overwrite --type SecureString \
    --name "/salmon-api/$stage/$NAME" --value "file://"<(printf '%s' "$NEW") >/dev/null
  echo "SSM $stage: $(fp "$(ssm_get "$stage" "$NAME")")"
done
case "$CI_NAMES" in
  *" $NAME "*)
    printf '%s' "$NEW" | gh secret set "$NAME" --env provider-tests -R "$REPO"
    ;;
esac
if [ -f "$ENV_FILE" ] && grep -q "^$NAME=" "$ENV_FILE"; then
  KEY_NAME="$NAME" perl -i -pe 'BEGIN { chomp($new = <STDIN>) } s/^\Q$ENV{KEY_NAME}\E=.*/$ENV{KEY_NAME}=$new/' \
    "$ENV_FILE" < <(printf '%s\n' "$NEW")
  echo ".env: $(fp "$(grep "^$NAME=" "$ENV_FILE" | cut -d= -f2-)")"
fi
command -v pbcopy >/dev/null && pbcopy </dev/null
NEW=""

last_deploy="$(gh run list -R "$REPO" --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
cat <<EOF
Clipboard emptied. Lambdas read SSM only when they are deployed:
  staging: npm run serverless:deploy:staging   (docs/DEPLOY.md, staging)
  prod:    gh run rerun ${last_deploy:-<last Deploy run id>} -R $REPO   (same tag again; or push the next prod/v* tag)
Then: ./scripts/rotate-provider-key.sh $NAME --verify, and revoke the old value at the provider.
EOF
