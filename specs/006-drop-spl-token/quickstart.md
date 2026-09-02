# Quickstart: verify dropping `@solana/spl-token`

## Baseline (before any source change)

```bash
git checkout 006-drop-spl-token
npm ci
npm ls bigint-buffer @solana/spl-token       # one path each — the "before"
npm run test:unit
```

## Step 1 — capture golden vectors against CURRENT code

```bash
npx jest src/services/solana/__tests__/burn-master-edition-equivalence.spec.js   # existing, green
# add burn-edition-golden.spec.js and nft-transfer-pnft-golden.spec.js, then:
npx jest src/services/solana/__tests__/ --testPathPatterns='golden|equivalence'
```

Commit the goldens on their own before touching `src/`.

## Step 2 — replace symbols, one at a time, goldens stay green

```bash
npx jest src/services/solana/__tests__/ --testPathPatterns='golden|equivalence|providers|nft-transfer|address'
```

## Step 3 — remove the package

```bash
npm uninstall @solana/spl-token
npm ls bigint-buffer @solana/spl-token       # both empty
npm audit --omit=dev                         # 0 vulnerabilities
git diff --stat package-lock.json            # removals only, no new packages
```

## CI gate (same as `.github/workflows/ci.yml`)

```bash
npm run format:check
npm run lint:check
npm run test:unit
npx serverless print --stage local > /dev/null
REDIS_HOST=localhost npm run test:integration:hermetic
```

## Manual smoke (docker-compose, `/local` prefix)

Build a burn and a pNFT transfer for a known devnet NFT via the existing
endpoints and diff the base64 `transaction` field against `main`.

## Post-deploy (24 h)

```bash
aws logs tail /aws/lambda/gol-salmon-api-prod-api --follow | grep -E "nft/(burn|transfer)|server_error"
```

Also watch wallet-side signing failures — a malformed instruction surfaces
there, not as a backend 5xx.
