# Usage analytics — ingest & GA4 forwarding

The wallet emits **opt-in, PII-free** usage events. They are posted in batches
to a dedicated ingest function and forwarded to Google Analytics 4. This doc
covers the backend half; the event catalogue and the client-side opt-in live in
`salmon-wallet-frontend` (`docs/ANALYTICS.md` there).

## Shape of the pipeline

```
wallet (ios / android / seeker / extension)
  → POST /v1/events            src/analytics/handler.js   (isolated Lambda)
      → allow-list re-validation  src/analytics/event-schema.js
      → sink.putRecords(...)      src/analytics/sink.js
          → Google Analytics 4    Measurement Protocol
```

- **`handler.js`** is a dependency-light Lambda, deliberately _not_ mounted in
  the Express app, so an event spike can't starve the wallet API. It **never
  reads the client IP** (`sourceIp` / `X-Forwarded-For` are untouched) and
  re-validates every event against the allow-list — a tampered client cannot
  slip an address, mint, raw number, or oversized string through.
- **`event-schema.js`** mirrors the wallet's allow-list (defense in depth): 20
  event names, 5 prop keys (`chain`, `from_chain`, `to_chain`, `success`,
  `powerup`), enum-checked values; no amount of any kind is accepted, because
  the consent copy promises none; `success` is accepted only as
  a boolean. A change here MUST match the client.
- **Platforms**: `handler.js` keeps `extension`, `ios`, `android`, `seeker`, and
  `mobile` (wallet builds before analytics v2); anything else is stored as
  `unknown`.

## Ingest protections

- **Origin**: a POST whose `Origin` is a web page (`http(s)://…` or `null`) gets
  `403 origin_not_allowed`. The wallet posts from an extension origin
  (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`) or, on
  mobile, with no `Origin`; any other `Origin` is refused the same way.
  This stops web pages from making visitors' browsers post invented events; a
  script outside a browser can still forge the header, so the figures remain
  self-reported.
- **Install id**: a batch without a usable `installId` (1–64 characters of
  `A-Z a-z 0-9 -`) gets `400 install_id_required`, so no GA user is invented for
  it. The wallet's ids are UUIDs, or `<time36>-<random36>` where
  `crypto.randomUUID` is missing.
- **Event time**: the GA4 sink sends `timestamp_micros` set to the start of the
  hour the batch arrived. GA otherwise dates an event by arrival, which follows
  a signature by a second or two and would let anyone holding the GA data match
  an install to its on-chain transactions. Reports keep hourly resolution;
  GA's Realtime view (last 30 minutes) may not show events stamped earlier in
  the hour, so verify delivery with a standard report. Events that follow an
  on-chain transaction (`TRANSACTION_EVENTS` in `src/analytics/event-schema.js`:
  sends, NFT sends, swaps, memos, paid payment requests, dApp transactions)
  keep only the day, in `ts`, `received_at` and GA's `timestamp_micros`,
  because over several transactions the hours a wallet was active single it
  out on the chain far sooner than the days do; they reach GA in a request of
  their own.

## Anonymity (why we proxy instead of a client SDK)

GA4 attributes an event to the IP of whoever calls `/mp/collect`. That caller is
**this backend**, so Google only ever sees the server IP — **the user's IP never
leaves the backend.** We deliberately do not send `ip_override`, which would
undo this. No Firebase/gtag SDK runs on any client, so no device phones Google
directly.

Each event carries `client_id = install_id`: a random, per-install token with no
PII and no link to a person. It is what lets GA4 build funnels ("how many who
onboarded did their first send"). It is the only persistent identifier involved.

`POST /v1/events` has no per-IP rate limit, by design: the handler never reads the client IP (not `requestContext.identity.sourceIp`, not `X-Forwarded-For`), and keying a limiter on it would reintroduce the address this pipeline exists to keep out. The API Gateway stage throttle is what bounds this route.

## Sinks (`ANALYTICS_SINK`)

| Value            | Behaviour                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `file` (default) | Append NDJSON to `ANALYTICS_FILE_PATH` (`./.analytics-local/…`). Zero external calls — local Docker runs and tests. |
| `ga4`            | Forward to GA4 via the Measurement Protocol. Production.                                                            |

Env vars (see `.env.example`):

- `ANALYTICS_SINK` — `file` or `ga4`.
- `GA4_MEASUREMENT_ID` — `G-XXXXXXXXXX`. Not a secret (ships in client tags by design).
- `GA4_API_SECRET` — **server-side secret.** Lives only in `.env` (gitignored)
  and the deployment secret store; never in the client, never committed.

The Measurement Protocol caps a request at 25 events; the sink chunks larger
batches. It answers 2xx for any well-formed request and does **not** validate
event contents synchronously, so a 2xx is _delivery_, not _acceptance_ — use the
one-time verification below to confirm events actually land.

## One-time GA4 setup (done in the browser)

There is no first-class Google CLI for this; it is ~5 minutes in the GA4 web
console (Admin). A community **GA4 MCP** exists that wraps the Admin API if you
prefer to script it, but the console is the supported path.

1. **Create a property** (or reuse one): Admin → Create property.
2. **Add a Web data stream**: Admin → Data Streams → Add stream → Web. Copy its
   **Measurement ID** (`G-…`) → `GA4_MEASUREMENT_ID`. All platforms (iOS, Android,
   Seeker, extension) report through this one web stream via the Measurement Protocol —
   we do not create app streams (those would require the Firebase SDK on device,
   which breaks the IP anonymity above).
3. **Create a Measurement Protocol API secret**: same data stream → Measurement
   Protocol API secrets → Create → copy the value → `GA4_API_SECRET`.
4. **Register custom dimensions** (required, easy to forget): Admin → Custom
   definitions → Create custom dimension, scope **Event**, one per param you want
   in reports — `platform`, `app_version`, `chain`, `from_chain`, `to_chain`,
   `success`, `powerup`. Until a param is registered it is delivered but
   **does not surface in reports**. `app_version` was shipped by the sink long
   before it was registered here, so events collected before that registration
   carry the value but cannot be reported on.
5. **Verify**: with `ANALYTICS_SINK=ga4` set, trigger an event and watch Admin →
   DebugView / Realtime. For payload-level debugging, the sink's endpoint has a
   debug twin at `https://www.google-analytics.com/debug/mp/collect` that returns
   validation messages.

## Testing locally

Leave `ANALYTICS_SINK=file` (the default) — events append to
`./.analytics-local/events.ndjson`, nothing leaves the machine. The GA4 mapping
itself is covered by `src/analytics/__tests__/sink.spec.js` (mocked `fetch`).
