# AGENTS.md instructions for `src/analytics`

## Responsibility

- anonymous usage-analytics ingest: the dedicated `POST /v1/events`
  Lambda (`handler.js`), event allow-list validation
  (`event-schema.js`), and the env-selected sink (`sink.js`: `file`
  for local/tests, `ga4` for prod).

## Local rules

- This folder is deliberately outside the chain-slice and
  routes/controllers/services layering: one route, one handler, no
  business flow. Do not "normalize" it into the layered model.
- It is a separate Lambda on purpose (concurrency isolation from the
  main `api` function) with an explicit route that wins over the
  `{proxy+}` catch-all. Keep it that way in `serverless.yml`.
- Privacy invariants: the handler never reads the client IP and the
  ga4 sink never forwards it. `context.appVersion` is semver-validated
  at ingest. Breaking either is a contract change.
- Event names are an allow-list. Adding an event means updating
  `event-schema.js` and the wallet client together.

## Testing

- Tests live in `src/analytics/__tests__/`. The file sink keeps unit
  tests hermetic — never require GA4 credentials in unit tests.

## Reference

- `docs/ANALYTICS.md` — full design and privacy model.
