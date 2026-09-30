# Contract: swap build (delta over spec 012)

`GET /v1/solana-mainnet/ft/swap/build?inputMint&outputMint&publicKey&(amount|uiAmount)&slippageBps`

Unchanged: the `SwapBuild` shape, the unsigned v0 transaction, the fee lines, error codes `missing_parameter`, `invalid_parameter`, `unknown_mint`, `token_not_supported`, `no_route`, `provider_fee_mismatch`, `swap_misconfigured`, `upstream_rate_limited`, `upstream_unavailable`, `request_budget_exhausted`.

New, in this order before any provider call:

1. `powerupGate('swap')`: country + platform → row. Unavailable → `403 region_restricted`.
2. Screening on rows whose provider does not screen (Jupiter): listed `publicKey` → `403 wallet_restricted`; no sanctions copy at all → `503 upstream_unavailable`.
3. Provider adapter chosen by the row: `jupiter` or `0x`. A row naming a provider without a configured credential → `503 upstream_unavailable`, no fallback.

Values: `provider` ∈ `'jupiter' | '0x'`; `attribution` ∈ `'Powered by Jupiter' | 'Powered by 0x'`; `routeFee` carries 0x's fee when 0x charges it, `null` otherwise.

Never added: any route that receives a signed transaction or broadcasts one.
