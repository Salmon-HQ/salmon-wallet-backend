# Quickstart: verify the SPL Token Registry replacement

## Before touching code — baseline

```bash
git checkout 005-replace-spl-token-registry
npm ci
npm run test:unit                         # green baseline
npm ls @solana/spl-token-registry cross-fetch
```

## During implementation (TDD order)

```bash
# 1. write the new unit cases, watch them fail
npx jest src/services/solana/__tests__/cdn-token-list-service.unit.spec.js
npx jest src/services/solana/__tests__/solana-ft-service.spec.js

# 2. implement, re-run until green
npm run test:unit

# 3. dependency cleanup
npm uninstall @solana/spl-token-registry
npm ls cross-fetch            # empty → remove the override from package.json, then:
npm install
npm audit --omit=dev          # expect only the documented bigint-buffer root
```

## Live check (nightly suite; needs network, no keys)

```bash
npm run test:integration -- cdn-token-list-service
```

## CI gate, same as `.github/workflows/ci.yml`

```bash
npm run format:check
npm run lint:check
npm run test:unit
npx serverless print --stage local > /dev/null
REDIS_HOST=localhost npm run test:integration:hermetic
```

## Manual smoke (docker-compose, `/local` prefix)

```bash
docker compose up -d
curl -s localhost:3000/local/v1/solana-devnet/account/<devnet-address>/transactions | jq '.[0]'
```

SPL transfer rows must carry `symbol` / `name` exactly as on `main`. Backend
log must show `Loading tokens from source for devnet` followed by a non-zero
`solana tokens loaded` count.

## Post-deploy

```bash
aws logs tail /aws/lambda/gol-salmon-api-prod-api --follow | grep -E "tokens loaded|server_error"
```
