#!/usr/bin/env bash
# Read-only audit of the production facts the privacy policy states.
#
# Each line is PASS, FAIL or INFO. FAIL means production no longer matches
# what the policy says, so either production or the policy has to change.
# Nothing here writes anything, and no secret is printed.
#
# Usage:  aws login && bash scripts/audit-production-privacy.sh
# Needs:  aws CLI (read access), curl, python3, node (run from the repo root
#         after `npm ci`, for the Redis check).
set -u

REGION="${AWS_REGION:-us-east-1}"
STAGE="prod"
API_NAME="gol-salmon-api-${STAGE}"
LOG_PREFIX="/aws/lambda/gol-salmon-api-${STAGE}-"
SSM="/salmon-api/${STAGE}"
EXPECTED_RETENTION=30
fails=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }
info() { printf 'INFO  %s\n' "$1"; }

aws sts get-caller-identity --query Account --output text >/dev/null 2>&1 ||
  { echo "Not logged in to AWS: run 'aws login' first."; exit 2; }

echo "== Request logs: kept ${EXPECTED_RETENTION} days, nowhere else"
groups=$(aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "$LOG_PREFIX" \
  --query 'logGroups[].[logGroupName,retentionInDays]' --output text)
[ -n "$groups" ] || fail "no log group under ${LOG_PREFIX}"
while read -r name days; do
  [ -z "$name" ] && continue
  if [ "$days" = "$EXPECTED_RETENTION" ]; then pass "$name: ${days} days"
  else fail "$name: retention is '${days}', the policy says ${EXPECTED_RETENTION} days"; fi
done <<<"$groups"

others=$(aws logs describe-log-groups --region "$REGION" --query 'logGroups[].logGroupName' --output text |
  tr '\t' '\n' | grep -v "^${LOG_PREFIX}" | grep -v '^$' || true)
if [ -z "$others" ]; then pass "no other log group in ${REGION}"
else fail "log groups the policy does not describe: $(echo "$others" | tr '\n' ' ')"; fi

echo "== API gateway and CDN: no access logs holding the caller's IP"
api_id=$(aws apigateway get-rest-apis --region "$REGION" \
  --query "items[?name=='${API_NAME}'].id | [0]" --output text)
if [ -z "$api_id" ] || [ "$api_id" = "None" ]; then fail "API ${API_NAME} not found"
else
  access=$(aws apigateway get-stage --region "$REGION" --rest-api-id "$api_id" --stage-name "$STAGE" \
    --query 'accessLogSettings.destinationArn' --output text)
  trace=$(aws apigateway get-stage --region "$REGION" --rest-api-id "$api_id" --stage-name "$STAGE" \
    --query 'methodSettings."*/*".loggingLevel' --output text)
  [ "$access" = "None" ] && pass "API gateway keeps no access log" || fail "API gateway access log is on"
  { [ "$trace" = "None" ] || [ "$trace" = "OFF" ]; } && pass "API gateway keeps no execution log" ||
    fail "API gateway execution logging is '${trace}'"
fi
for id in $(aws cloudfront list-distributions --query 'DistributionList.Items[].Id' --output text); do
  on=$(aws cloudfront get-distribution-config --id "$id" --query 'DistributionConfig.Logging.Enabled' --output text)
  [ "$on" = "False" ] && pass "CDN ${id} keeps no access log" || fail "CDN ${id} access logging is on"
done

echo "== What the device connects to directly"
api_url="https://${api_id}.execute-api.${REGION}.amazonaws.com/${STAGE}/v1/networks"
curl -s --max-time 20 "$api_url" | python3 -c '
import json, re, sys
try:
    body = json.load(sys.stdin)
except Exception:
    print("FAIL  could not read /v1/networks"); sys.exit(0)
for net in body.get("data", body) if isinstance(body, dict) else body:
    url = (net.get("config") or {}).get("nodeUrl") or ""
    host = re.sub(r"^[a-z]+://", "", url).split("/")[0].split("?")[0]
    if host:
        print("INFO  %s -> *.%s" % (net.get("id"), ".".join(host.split(".")[-2:])))
'
info "solana-mainnet must resolve to the provider the policy names (rpcpool.com is Triton One)"

echo "== Rate-limit counter: how long an IP is held"
window=$(aws ssm get-parameter --region "$REGION" --name "${SSM}/RATE_LIMIT_WINDOW_SECONDS" \
  --query Parameter.Value --output text 2>/dev/null || true)
if [ -z "$window" ]; then pass "window is the repo default (60 s)"
elif [ "$window" = "60" ]; then pass "window is 60 s"
else fail "window is ${window} s, the policy says 60 s"; fi

echo "== Redis: encrypted connection, nothing kept past its expiry"
param() { aws ssm get-parameter --region "$REGION" --name "${SSM}/$1" --with-decryption \
  --query Parameter.Value --output text 2>/dev/null; }
redis_report=$(RH=$(param REDIS_HOST) RP=$(param REDIS_PORT) RPW=$(param REDIS_PASSWORD) RT=$(param REDIS_TLS) node -e '
const { createClient } = require("redis");
const tls = process.env.RT === "true";
const host = process.env.RH || "";
console.log("INFO  provider: *." + host.split(".").slice(-2).join("."));
console.log((tls ? "PASS" : "FAIL") + "  connection to Redis is " + (tls ? "encrypted (TLS)" : "NOT encrypted"));
(async () => {
  const c = createClient({ socket: { host, port: Number(process.env.RP), tls, connectTimeout: 8000, reconnectStrategy: false }, password: process.env.RPW });
  c.on("error", () => {});
  await c.connect();
  const info = await c.sendCommand(["INFO"]);
  const pick = (k) => (info.match(new RegExp("^" + k + ":(.*)$", "m")) || [])[1];
  const db = pick("db0") || "";
  const keys = Number((db.match(/keys=(\d+)/) || [])[1] || 0);
  const expires = Number((db.match(/expires=(\d+)/) || [])[1] || 0);
  // The manual block list and the sanctions list carry no expiry on purpose
  // and hold no user data; anything beyond those two is unexpected.
  const unexpired = keys - expires;
  console.log((unexpired <= 3 ? "PASS" : "FAIL") + "  " + keys + " keys, " + unexpired + " without an expiry (sanctions list, its timestamp and the manual block list are the only ones allowed)");
  console.log("INFO  append-only persistence: " + (pick("aof_enabled") === "1" ? "on" : "off") + "; last snapshot to disk: " + (pick("rdb_last_save_time") ? new Date(Number(pick("rdb_last_save_time")) * 1000).toISOString().slice(0, 10) : "unknown"));
  await c.quit();
})().catch((e) => console.log("FAIL  could not reach Redis: " + String(e.message).slice(0, 80)));
' 2>/dev/null)
echo "$redis_report"
fails=$((fails + $(echo "$redis_report" | grep -c '^FAIL')))

echo "== Not visible from here: check by hand"
info "Google Analytics 4 > Admin > Data retention: event data 2 months, user data 14 months"
info "Redis provider console: backups off"

echo
if [ "$fails" -eq 0 ]; then echo "All checks passed."; else echo "${fails} check(s) failed."; exit 1; fi
