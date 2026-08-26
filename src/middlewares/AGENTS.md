# AGENTS.md instructions for `src/middlewares`

## Responsibility

- Express middlewares that run before controllers
- request-shape validation, network resolution, rate limiting

## Current contents

- `multinetwork.js` — resolves `req.params.networkId` to
  `res.locals.network` from `src/constants/networks.js`. Supports a
  `{ blockchains: [...] }` allowlist that calls `next('route')` to
  fall through when the resolved chain is not allowed for the current
  mount. The chain-mount loop in `src/index.js` relies on this filter
  to keep slice routers from shadowing each other.
- `rate-limit.js` — per-IP fixed-window rate limiting backed by Redis,
  fail-open. Mounted globally over `/v1` and again, stricter, over the
  transaction-building routes in `src/index.js`.
- `error-handler.js` — the final 4-arg error middleware mounted last in
  `src/index.js`. Resolves the response status from, in order,
  `err.statusCode`/`err.errorCode`, an upstream `err.response.status`
  (400/404/422 map to `bad_request`/`not_found`/`unprocessable_entity`;
  every other upstream status stays 500), and 500 `server_error` otherwise.
  Only string upstream messages reach `error_description`, so a provider's
  object/HTML body is never echoed to clients.

## Rules

- Keep middlewares small and single-purpose. If a middleware grows
  branching, push the logic into a controller or service.
- Never call into chain-specific services from a middleware. Resolve
  the network via `multinetwork` and let the controller dispatch.
- Errors from middlewares MUST be returned as HTTP responses, never
  thrown into the global error handler unless they are truly unexpected.

## Testing

- Tests live in `src/middlewares/__tests__/`. Cover the
  `next('route')` fall-through path explicitly when a middleware uses
  it — without that coverage, slice-routing regressions pass silently.
