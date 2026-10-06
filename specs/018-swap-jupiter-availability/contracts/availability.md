# Contract: capability availability

`GET /v1/solana-{env}/powerups/availability`

- Anonymous, like every route. `Cache-Control: no-store`; never served from the edge cache.
- Inputs the backend reads: the source address of the request (API Gateway), the `X-Salmon-Platform` header, the network in the path.
- Response `200`:

```json
{
  "data": [
    { "id": "payments", "enabled": true },
    { "id": "swap", "enabled": true, "provider": "jupiter" },
    { "id": "swap", "enabled": false, "reason": "region" }
  ]
}
```

- One entry per registered Powerup on the network plus `swap`; `reason` only when `enabled: false`, from `region | maintenance | deprecated`; `provider` only when `enabled: true` and the capability has providers.
- Unresolvable country → the default provider, `enabled: true`.
- Errors: `400 invalid_parameter` for an unknown network; never 403 (this route informs, the build route refuses).

Client contract (frontend spec 027 §4): the `PowerupAllowlist` the hooks consume is built from this response; `/v1/networks.powerups` remains for 1.2.0 clients and is not read by clients that know this route.
