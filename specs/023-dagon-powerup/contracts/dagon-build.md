# Contract: `GET /v1/solana-devnet/powerups/dagon/build`

The existing generic Powerup build route (`src/routes/solana/solana-powerups-router.js:26`) with id `dagon`. No route is added; the signing-boundary allowlist (`src/__tests__/signing-boundary.spec.js`) is unchanged. Same contract as the frontend spec 043.

## Request

Headers: `X-Salmon-Platform: ios` (the availability row offers `dagon` on iOS only; a missing header resolves to `ios`, `src/availability/platform.js:22-26`).

| Action           | Required query                                                               | `freshSigners` count |
| ---------------- | ---------------------------------------------------------------------------- | -------------------- |
| `setup`          | `publicKey`, `side`, `freshSigners`; optional `owner` (default `publicKey`)  | 1                    |
| `wrap`           | `publicKey`, `side`, `amount`, `freshSigners`                                | 1                    |
| `reveal`         | `publicKey`, `side`, `viewer`, `freshSigners`                                | 1                    |
| `send`           | `publicKey`, `side`, `amount`, `to`, `freshSigners=` (empty)                 | 0                    |
| `swap`           | `publicKey`, `sideIn`, `sideOut`, `amountIn`, `minAmountOut`, `freshSigners` | 1                    |
| `unwrapBurn`     | `publicKey`, `side`, `amount`, `freshSigners`                                | 1                    |
| `unwrapDecrypt`  | `publicKey`, `burnedCt`, `freshSigners`                                      | 1                    |
| `unwrapComplete` | `publicKey`, `burnedCt`, `requestAcct`, `freshSigners=` (empty)              | 0                    |

`freshSigners` is one comma-separated string of base58 public keys the device generated. Amounts are base-unit integers as strings.

## Response 200

The existing Powerup build resource (`src/resources/solana/solana-powerup-build-resource.js`):

```json
{
  "provider": "dagon",
  "providerDisplayName": "Dagon (devnet preview)",
  "attribution": null,
  "transaction": "<base64 unsigned v0 transaction>",
  "expiresAt": "<ISO, now + 60 s>",
  "salmonFee": null,
  "routeFee": null,
  "contributor": null,
  "priorityFeeMicroLamports": 1000,
  "computeUnitLimit": 123456,
  "action": "swap",
  "sideIn": "USDC",
  "sideOut": "DOGE",
  "amountIn": "100",
  "minAmountOut": "90",
  "decimals": 2,
  "outcomeKnownAfterReveal": true
}
```

The transaction's fee payer is `publicKey`; its required signers are exactly `publicKey` followed by the `freshSigners`, zero signatures attached; every top-level program is one of pc-token, pc-swap, Encrypt, SPL Token, System, Compute Budget. Legacy instead of v0 only if task zero (FR-028) shows the executor ignores v0, and then for `dagon` alone.

## Errors (envelope `{ error, error_description }`)

| Status | `error`                                                                      | When                                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `missing_parameter` / `invalid_parameter`                                    | missing or malformed field; secret-like key; unknown side; same side in and out; amount out of range; `to` = caller; `requestAcct` not the receipt's |
| 400    | `invalid_fresh_signers`                                                      | wrong count, duplicate, invalid, equal to another key in the request, or already exists on chain                                                     |
| 403    | `region_restricted`                                                          | embargoed country (gate)                                                                                                                             |
| 404    | `not_found`                                                                  | not `solana-devnet`, stage off, or the platform row is off (Android, extension)                                                                      |
| 409    | `already_initialized`                                                        | setup: the pc-account exists                                                                                                                         |
| 409    | `setup_required`                                                             | the caller has no pc-account for a side the action needs                                                                                             |
| 409    | `recipient_setup_required`                                                   | send: the recipient has no pc-account                                                                                                                |
| 409    | `balance_settling`                                                           | swap/send: input balance pending or never committed; unwrapDecrypt: `burnedCt` pending                                                               |
| 409    | `receipt_not_found`                                                          | unwrap: no receipt for `burnedCt`, or not the caller's                                                                                               |
| 409    | `already_requested`                                                          | unwrapDecrypt: decryption already requested                                                                                                          |
| 422    | `simulation_failed`                                                          | the runtime rejected it (e.g. wrap above the SPL balance; unwrapComplete before the decryption is posted)                                            |
| 502    | `provider_program_mismatch`                                                  | an undeclared program (shared guard)                                                                                                                 |
| 502    | `provider_signer_mismatch`                                                   | the compiled signers differ from `{publicKey} ∪ freshSigners`                                                                                        |
| 502    | `executor_bad_response`                                                      | `createInput` returned zero or several ids, or a malformed answer                                                                                    |
| 503    | `dagon_config_unavailable`                                                   | no acceptable `devnet.json` (unreachable with no cached copy, malformed, wrong cluster, pinned-id or executor-host mismatch)                         |
| 503    | `executor_unavailable`                                                       | executor unreachable, 5xx, or its circuit is open                                                                                                    |
| 503    | `executor_pending`                                                           | inputs not committed within the request budget (retry; nothing was signed)                                                                           |
| 503    | `pool_unavailable`                                                           | pool missing or a reserve still pending                                                                                                              |
| 503    | `simulation_unavailable`, `request_budget_exhausted`, `upstream_unavailable` | existing shared answers                                                                                                                              |

Nothing in the response states an outcome. Silent on-chain failures (insufficient balance, missed floor) build successfully; the device learns the outcome by revealing.
