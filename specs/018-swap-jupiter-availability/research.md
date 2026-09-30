# Research: Swap on Jupiter, 0x where Jupiter cannot, offered where it may be offered

Research date: 2026-09-30. Sources fetched directly unless marked
**UNVERIFIED**. Not legal advice.

## R1 — Where the caller's country comes from

**Decision**: resolve the country inside the backend from API Gateway's
`requestContext.identity.sourceIp` (the resolver already in
`src/middlewares/rate-limit.js`, to be moved to `packages/network-utils`),
looked up in a country database shipped inside the bundle.

**Rationale**: `sourceIp` is set by API Gateway from the TCP connection; a
caller cannot write it, unlike any header. It works today, without
CloudFront in front of the API (DEV-22 is blocked on the
`actions.salmonwallet.io` decision) and without an external lookup per
request. `geo-service.js` (ip-api.com, free tier, non-commercial terms,
3 s timeout, one HTTP call per request) is the wrong shape for a gate on
every build and stays what it is: the `/ip` info endpoint.

**Alternatives considered**: CloudFront viewer-country header (needs DEV-22
and origin locking first); ip-api.com per request (external dependency on
the hot path, commercial use needs a paid plan); GPS from the device
(permission prompt, App Review red flag, spoofable).

## R2 — Which country database

**Decision**: DB-IP "IP to Country Lite" packaged as
`@ip-location-db/dbip-country-mmdb` (npm, version `2.3.2026060120`,
licence CC BY 4.0, unpacked 16 MB, the `.mmdb` about 8 MB), read with
`mmdb-lib` (MIT, 34 KB). Attribution line in `NOTICE` and `AGENTS.md`:
"IP Geolocation by DB-IP (https://db-ip.com)".

**Rationale**: no account, no licence key, CC BY without share-alike, and a
monthly npm release so Dependabot carries the refresh. MaxMind GeoLite2
needs an account and a licence key, is CC BY-SA, and its EULA governs
redistribution.

**Alternatives considered**: MaxMind GeoLite2 Country (~9 MB mmdb, account

- key + EULA); `@ip-location-db/dbip-country` CSV (67 MB, no reason to
  carry CSV when mmdb exists).

**Open**: the package has been released monthly; if a release is missed
the data ages, which only matters at the edges of address blocks. Accepted.

## R3 — The availability table: where it lives

**Decision**: one SSM parameter per stage,
`/salmon-api/<stage>/AVAILABILITY_TABLE`, JSON, read at runtime through the
SSM client the Lambda runtime already ships, cached 5 minutes per
container, with a built-in default in code equal to the spec's initial
rows. A read failure or an invalid document keeps the last good table (or
the default) and logs an error.

**Rationale**: the rest of the config is resolved at deploy time
(`${ssm:…}` in `config/env.prod.yml`), which would make every country
change a release — exactly what the spec forbids. A runtime read needs one
IAM statement (`ssm:GetParameter` on that name) and no new service. A
standard SSM parameter holds 4 KB, an advanced one 8 KB; the table is well
under 4 KB.

**Alternatives considered**: Redis (no audit trail of who changed it, needs
an admin path to write); deploy-time env (a release per change); AppConfig
(another service for one JSON document).

## R4 — Table shape and validation

**Decision**: per capability, a default provider, a list of unavailable
countries, per-provider country lists, and optional per-platform overrides
of the same three keys. Countries are ISO-3166 alpha-2 plus the three
region codes `UA-43` (Crimea), `UA-14` (Donetsk) and `UA-09` (Luhansk),
which the country database resolves only at country level — so the
regions are enforced by refusing `UA` **only** when the database reports a
region code, which DB-IP Country Lite does not. **Accepted gap**: the
three Ukrainian regions are not distinguishable from the rest of Ukraine
with a country-level database; refusing all of Ukraine is not acceptable.
Documented in the spec's "what this gate is not"; counsel decides whether
a city-level database is required later.

Validation on load: unknown provider name, a Jupiter row for a country in
Jupiter's prohibited list, an unknown platform key → the document is
rejected and the previous table stays in force.

## R5 — Platform signal

**Decision**: header `X-Salmon-Platform: ios | android | extension`, sent by
every client through `createApiClient`; missing or unknown → treated as
`ios`, the most restrictive platform.

**Rationale**: the stores' rules bind the build they reviewed; a forged
header cannot open a country that is blocked on every platform; "most
restrictive by default" means an old client that never sends the header
gets the iOS answer, which is the safe one.

## R6 — Sanctions screening: two layers, the Treasury copy authoritative

**Decision**: on rows whose provider does not screen (Jupiter), the gate
checks the wallet address against a **daily copy of the US Treasury SDN
list** held in Redis (exact match, every `Digital Currency Address - *`
value, any chain) and, in addition, asks **TRM Labs' free sanctions
screening API** (`POST https://api.trmlabs.com/public/v1/sanctions/screening`,
header `TRM-API-Key` when configured), caching TRM's answer per address for
24 h. Either layer listing the address refuses with `403 wallet_restricted`.
With neither layer able to answer, 503 `upstream_unavailable`: screening
is never skipped silently. The local copy alone is enough to answer; TRM
alone answers too, with `[SANCTIONS_LOCAL_MISSING]` logged as an ops error.

**Verified 2026-09-30**:

- The Treasury's list service serves the SDN CSV after one redirect to a
  signed S3 URL:
  `https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV`
  (5.7 MB; 513 `Digital Currency Address - <SYMBOL> <address>` entries,
  2 with symbol `SOL`).
- TRM's free endpoint answers without a key (`x-ratelimit-limit: 60` per
  minute) but returned `isSanctioned: false` for **both** Solana addresses
  and for two Bitcoin addresses that are on the SDN CSV of the same day.
  It rejects a `chain` field. So it cannot be the primary layer: it adds
  coverage when it flags something, and proves nothing when it does not.

**Rationale**: the Treasury list is the source the Jupiter terms point at
and the one the wallet can hold verbatim; TRM adds whatever its free tier
covers at no cost. Both cost nothing.

**Open — UNVERIFIED**: which lists TRM's free API covers and whether its
terms allow commercial use without a paid plan (DEV-76). If they do not,
the local copy is the only layer and nothing else changes.

**Alternatives considered**: Chainalysis free screening API (needs a key,
not probed); Elliptic (paid); a community feed on GitHub (adds a third
party between Salmon and the Treasury, rejected as a source).

## R7 — Jupiter adapter and fee mapping

**Decision**: `GET https://api.jup.ag/swap/v2/build` with `inputMint`,
`outputMint`, `amount`, `taker`, `slippageBps`, `platformFeeBps`,
`feeAccount`, header `x-api-key`. The response carries
`computeBudgetInstructions`, `setupInstructions`, `swapInstruction`,
`cleanupInstruction`, `otherInstructions`, `addressesByLookupTableAddress`
and `blockhashWithMetadata`; the adapter flattens them into the internal
shape the 0x adapter already returns and drops Jupiter's blockhash in
favour of the builder's own (the builder fetches and reports `expiresAt`).
`feeAccount` is the fee owner's associated token account for the output
mint (Jupiter takes the platform fee from the output token on ExactIn),
resolved by the existing `resolveFee` (output first, input second, none
third with `[SWAP_FEE_SKIPPED]`). Rate profile: `jupiter`, 10 rps, burst
10, timeout 10 s, retry on 429 honouring `Retry-After`, breaker default.
`/swap/v2/order` and `/execute` are never used: they assemble and
broadcast on Jupiter's side, which the signing boundary forbids.

**Verified**: the production key answers `/swap/v2/build` with
`x-ratelimit-remaining: 9` after one call (Developer plan, 10 rps); the
Router path charges no Jupiter fee (docs, 2026-09-30).

**Open**: Jupiter's `feeAccount` must be a token account of the output
mint's program (SPL Token or Token-2022); the existing ATA derivation
already handles both programs for 0x. To confirm with a recorded fixture.

## R8 — Provider selection and the 0x adapter

**Decision**: the gate writes `res.locals.availability = { provider }` and
the build service picks the adapter by that value; `PROVIDER` constants
move into each adapter. The 0x adapter, fee verification, priority-fee
prepend and intermediate-account cleanup come from `feat/powerup-swap`
unchanged. Profile row `zeroex` at 5 rps replaces the branch's ad-hoc
`zeroex-rate-limiter`.

## R9 — What the availability route returns and who reads it

**Decision**: `GET /v1/solana-{env}/powerups/availability`, `Cache-Control:
no-store`, `[{ id, enabled, reason?, provider? }]` for every registered
Powerup on that network plus the `swap` capability. The frontend's
`useNetworkPowerups` switches its allowlist source from `/v1/networks`
(cached an hour at the edge) to this route, keeps the same
`PowerupAllowlist` shape, and carries `provider` through to the swap
screen for attribution. `/v1/networks` keeps its `powerups` block for
backwards compatibility with 1.2.0 clients.
