# Implementation Plan: Region gating for Powerups

**Branch**: `011-region-gating` (spec only) → **implement on a new branch from `main`** | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

## Summary

Three layers, each independently testable: (1) trust — CloudFront-only
origin + forwarded viewer-country headers; (2) policy — per-stage Powerup
config with country allowlists, published on `/v1/networks`; (3)
enforcement — one middleware that gated routes mount, plus address
screening behind a swappable interface.

## Technical Context

Node 20 CJS, Express 5, Jest 30. Existing pieces reused:
`src/network-capabilities/network-capabilities-<stage>.js` +
`network-capabilities-service.js` (stage-derived rule trees),
`network-resource.js` (`sections` on `/v1/networks`), the error envelope
and `error-handler.js`. Infra: CloudFront `E394LJ6ODNZBST` → API Gateway
`te4x28v8e0` (REST). No new AWS services.

## Constitution Check (AGENTS.md)

| Gate                                           | Status                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Cross-domain policy lives in `services/shared` | PASS — gating config + service under `shared`, middleware under `middlewares`                            |
| Never 200 with degraded data                   | PASS — refusals are 403/404/503 with codes; screening outage is 503                                      |
| Error envelope                                 | PASS — new codes `origin_not_trusted`, `region_restricted`, `wallet_restricted`, `screening_unavailable` |
| Secrets only in SSM                            | PASS — origin secret via `${ssm:/salmon-api/prod/CLOUDFRONT_ORIGIN_SECRET}`                              |
| Public contract change deliberate              | PASS — additive `powerups` on `/v1/networks`; `GET /ip` removed (no consumer)                            |

## Design

### 1. Trust: origin lock + headers (ops + one middleware)

Ops (console or IaC, outside `serverless.yml`):

- Attach managed origin request policy `AllViewerExceptHostHeader`
  (`b689b0a8-53d0-40ab-baf2-68738e2966ac`) to the API behaviour(s) — this
  forwards `CloudFront-Viewer-Country` and `-Country-Region`.
- Add a custom origin header `X-Origin-Secret: <random 32+ bytes>` on the
  origin; store the same value in SSM `/salmon-api/prod/CLOUDFRONT_ORIGIN_SECRET`.
  Rotation = set new value in both places, deploy, then remove old.

Backend `src/middlewares/trusted-origin.js`, mounted first in
`src/index.js`:

```js
if (process.env.NODE_ENV !== 'local') {
  if (req.get('x-origin-secret') !== process.env.CLOUDFRONT_ORIGIN_SECRET) → 403 origin_not_trusted
}
res.locals.viewerCountry = normalizeCountry(req.get('cloudfront-viewer-country')); // 'AR' | null
res.locals.viewerRegion  = req.get('cloudfront-viewer-country-region') || null;
```

Exempt `/health` from the secret check (ALB/UptimeRobot may hit the
gateway directly) — or route health through CloudFront too; decide during
implementation, document either way. Alternative to the header: an API
Gateway resource policy allowing only the CloudFront prefix list
(`com.amazonaws.global.cloudfront.origin-facing`); the header is simpler
and works on REST APIs without a redeploy of the gateway policy.

### 2. Policy: per-stage Powerup config

`src/network-capabilities/powerups-<stage>.js` (same loader pattern as
`network-capabilities-<stage>.js`):

```js
module.exports = {
  sanctionedCountries: ['CU', 'IR', 'KP', 'SY', 'RU-CR' /* owner-confirmed list */],
  powerups: {
    swap: {
      enabled: false, // flips on with spec 012
      networks: ['solana'],
      countries: [], // OWNER DECISION — empty = nowhere
    },
  },
};
```

`src/services/shared/powerups-service.js`: `getPowerups(stage)`,
`isPowerupEnabled(id, network)`, `isCountryAllowed(id, country)`.
`network-resource.js` adds `powerups: { [id]: { enabled, networks } }`
(strip `countries` — region-agnostic, cacheable).

### 3. Enforcement

`src/middlewares/powerup-gate.js` — `powerupGate('swap', { addressParam: 'publicKey' })`:

1. `!isPowerupEnabled(id, res.locals.network)` → 404 `not_found`.
2. `country == null || sanctioned.includes(country) || !countries.includes(country)` → 403 `region_restricted` ("This feature is not available in your region.").
3. `await screening.isRestricted(address)` → true → 403 `wallet_restricted`; throws → 503 `screening_unavailable`.
4. Log `{ powerup, country, outcome }` (no IP, no address in the region line; address only on `wallet_restricted`).

Gated routes declare it: `router.get('/swap/quote', powerupGate('swap', …), safe(controller.quote))` (spec 012).

### 4. Screening

`src/services/shared/wallet-screening-service.js` exporting
`isRestricted(address)`. First implementation: a JSON list under
`src/services/shared/data/` seeded from the OFAC SDN digital-currency
addresses (Solana entries), refreshed by a scheduled job like the
CoinGecko one, cached in Redis. Interface stays the same if the owner
later contracts TRM/Chainalysis. **Owner decision recorded here before
implementation: list vs provider.**

### 5. Cleanup

Remove `GET /ip`, `geo-service.js`, `info-controller`'s use of it, and
tests.

## Test plan

- Unit: `trusted-origin` (secret present/absent/local), `powerup-gate`
  (matrix: disabled / no country / sanctioned / not allowed / allowed /
  restricted address / screening down), `powerups-service` config
  loading per stage, `network-resource` `powerups` shape.
- Hermetic integration: request without secret → 403 through the real
  app; with secret + `CloudFront-Viewer-Country: AR` on a gated test
  route → passes gate.
- `serverless print --stage local` with the new SSM ref.
- Manual after deploy: `curl https://te4x28v8e0.execute-api.us-east-1.amazonaws.com/prod/health` (direct) → 403; via `d1fh2pwo7kzely.cloudfront.net` → 200.

## Rollout / rollback

1. Deploy backend with the secret check **disabled by absent env** (middleware skips when `CLOUDFRONT_ORIGIN_SECRET` is unset) — no behaviour change.
2. Ops: attach policy + custom header on CloudFront; put SSM param.
3. Redeploy → check enforced. Rollback = unset the SSM param and redeploy.
4. Powerup allowlists start empty; enabling a country is a config PR reviewed like code, with the evidence (provider terms / counsel note) linked in the PR.

## Ops checklist (outside the repo)

- CloudFront `E394LJ6ODNZBST`: origin request policy `AllViewerExceptHostHeader`; custom origin header `X-Origin-Secret`.
- SSM: `/salmon-api/prod/CLOUDFRONT_ORIGIN_SECRET` (SecureString).
- App Store Connect / Google Play: country availability kept equal to the union of enabled Powerup allowlists **only if** the app itself is region-limited — otherwise the wallet stays worldwide and only Powerups are gated (owner decision; the spec assumes the latter).
