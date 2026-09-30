# Data model: availability, screening and the swap build

## Availability table (configuration, SSM `/salmon-api/<stage>/AVAILABILITY_TABLE`)

```json
{
  "version": 1,
  "capabilities": {
    "swap": {
      "default": "jupiter",
      "unavailable": ["CU", "IR", "KP", "SY", "US"],
      "providers": {
        "0x": ["CN", "SG", "MM", "CI", "CD", "IQ", "LY", "ML", "NI", "SO", "SD", "YE", "ZW"]
      },
      "platforms": {
        "ios": {}
      }
    }
  }
}
```

- `default`: provider name for any country not listed elsewhere.
- `unavailable`: countries where the capability is not offered.
- `providers`: provider name → countries served by that provider instead of the default.
- `platforms.<ios|android|extension>`: optional overrides of the same three keys, merged over the capability's values for that platform. An empty object means "same as everywhere".
- Provider names: `jupiter`, `0x`. Countries: ISO-3166 alpha-2, upper case.
- Validation (on load; failure keeps the previous table): known provider names; no `jupiter` row for a country in `JUPITER_PROHIBITED` (constant in code, from Jupiter's Terms of Use); known platform keys; `version` = 1.
- Built-in default (in code): exactly the document above. It is what serves when SSM is unreadable.

## Decision (per request, in memory only)

```
{ capability: 'swap', platform: 'ios'|'android'|'extension', country: 'AR'|null,
  enabled: boolean, reason?: 'region', provider?: 'jupiter'|'0x' }
```

- `country: null` (unresolvable address) → `enabled: true` with the default provider (fail open, logged).
- Never persisted; logged as `{ capability, platform, country, enabled, provider }` without the wallet address.

## Sanctions copy (Redis)

- `sanctions:addresses` — set of strings, every `Digital Currency Address - *` value from the SDN list, any symbol, verbatim.
- `sanctions:fetched_at` — ISO timestamp of the last successful refresh.
- Refresh: download → parse → `SADD` into `sanctions:addresses:next` → `RENAME` over the live key → set `fetched_at`. A parse that yields zero addresses is treated as a failure and leaves the live set alone.
- Read: `SISMEMBER sanctions:addresses <publicKey>`; `fetched_at` older than 48 h → error log; key missing → 503 on rows that require screening.

## Provider profiles (`profiles.js`)

| name    | rps                    | burst | timeout | retry                                   | breaker |
| ------- | ---------------------- | ----- | ------- | --------------------------------------- | ------- |
| jupiter | 10 (`JUPITER_MAX_RPS`) | 10    | 10 s    | 429/5xx, honour Retry-After, 3 attempts | default |
| zeroex  | 5 (`ZEROEX_MAX_RPS`)   | 5     | 10 s    | same                                    | default |

## Swap build response (`SwapBuild`, unchanged from spec 012 except values)

- `provider`: `'jupiter'` | `'0x'`; `providerDisplayName`: `'Jupiter'` | `'0x'`; `attribution`: `'Powered by Jupiter'` | `'Powered by 0x'`.
- `salmonFee`: `{ amount, mint, bps: 50, decimals, symbol, side }` or `null` when no fee account exists for either side.
- `routeFee`: `null` for Jupiter Router; for 0x, `{ bps: 15 }` while 0x charges it, `null` during the Solana beta waiver — read from the provider's response, never hard-coded.
- Everything else as spec 012: unsigned base64 v0 `transaction`, `expiresAt`, `input`/`output` with `minAmount`, `route`, `priceImpactPct`, `slippageBps`, USD values, `providerRequestId`.

## Internal adapter shape (both adapters)

```
{ instructions: TransactionInstruction[], lookupTableAddresses: string[],
  amountOut: bigint, minAmountOut: bigint, routePlan: [{ label, percent }],
  providerRequestId: string|null, providerFeeBps: number|null }
```
