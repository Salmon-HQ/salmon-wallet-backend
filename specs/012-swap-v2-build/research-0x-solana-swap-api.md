# 0x Solana Swap API — primary-source reference

Researched 2026-09-10 against the raw `.md` renders of docs.0x.org (append `.md` to any page URL), the published OpenAPI 3.1 spec, the example repo linked from the docs, and live unauthenticated probes of `api.0x.org`. Every fact carries its source. Anything the sources do not state is marked **UNVERIFIED**.

Sources (short names used below):

- **[GET-STARTED]** https://docs.0x.org/svm/solana-swap-api/guides/get-started-with-solana-swap-api.md
- **[REF-SWAP]** https://docs.0x.org/api-reference/solana-swap-ap-is/swap/instructions.md
- **[REF-SOURCES]** https://docs.0x.org/api-reference/solana-swap-ap-is/sources/enabled-sources.md
- **[OPENAPI]** https://docs.0x.org/openapi/solana-swap-apis.json (found via https://docs.0x.org/api-reference/download-open-api-spec.md; fetched, `openapi: 3.1.0`, `info.title: "Solana Swap APIs"`, `info.version: "1.0.0"`)
- **[MONETIZE]** https://docs.0x.org/svm/solana-swap-api/guides/monetize-your-app.md
- **[INTEG-NOTES]** https://docs.0x.org/svm/solana-swap-api/guides/important-integration-notes.md
- **[BYTES]** https://docs.0x.org/svm/solana-swap-api/guides/integrator-byte-costs.md
- **[TROUBLESHOOT]** https://docs.0x.org/svm/solana-swap-api/troubleshooting.md
- **[API-ISSUES]** https://docs.0x.org/docs/introduction/api-issues.md (EVM-only content, see §6)
- **[RATE-LIMITS]** https://docs.0x.org/docs/developer-resources/rate-limits.md
- **[USING-AI]** https://docs.0x.org/docs/introduction/develop-with-ai/using-ai-with-0x.md
- **[INTRO]** https://docs.0x.org/svm/solana-swap-api/introduction.md
- **[EVM-TO-SOL]** https://docs.0x.org/svm/solana-swap-api/guides/evm-to-solana.md
- **[API-OVERVIEW]** https://docs.0x.org/api-reference/api-overview.md
- **[EXAMPLE]** https://github.com/jlin27/0x-solana-example (the docs link `github.com/0xProject/0x-solana-example` returns 404; `jlin27` fork is the reachable copy, last commit 2025-08-05 "Update req res params snake case and url")
- **[PROBE]** live `curl` against `https://api.0x.org/solana/*` without / with an invalid API key, 2026-09-10

Status banner on every Solana page: "The 0x Solana Swap API is in **open beta** … Interfaces may still change" [INTRO][GET-STARTED][MONETIZE][INTEG-NOTES][BYTES][TROUBLESHOOT]. Supported network: "0x Solana Swap API supports Solana Mainnet Beta." [INTRO] — no devnet mentioned anywhere.

---

## 1. Base URL, endpoints, headers

**One swap endpoint, not two.** There is no separate price/quote vs build step on Solana. The single `POST /swap-instructions` returns the quote numbers and the instructions together [REF-SWAP][OPENAPI]. The Get Started guide labels the same call "1. Fetch a Quote" and then "2. Build Swap Instructions" purely as client-side decoding steps [GET-STARTED]. The OpenAPI `paths` object contains exactly two entries: `/enabled-sources` and `/swap-instructions` [OPENAPI].

| Item                                   | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Source                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Server URL                             | `https://api.0x.org/solana`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | [OPENAPI] `servers[0].url`                              |
| Swap                                   | `POST https://api.0x.org/solana/swap-instructions`, `Content-Type: application/json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [REF-SWAP][OPENAPI] `operationId: "instructions"`       |
| Sources                                | `GET https://api.0x.org/solana/enabled-sources`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | [REF-SOURCES][OPENAPI] `operationId: "enabled-sources"` |
| Auth header                            | `0x-api-key` (string, required) — "Visit dashboard.0x.org to get your API Key"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | [REF-SWAP][REF-SOURCES][OPENAPI]                        |
| `0x-version` header                    | **Not listed** for either Solana endpoint in [REF-SWAP], [REF-SOURCES] or [OPENAPI]; not sent by the docs' JS example [GET-STARTED] nor by [EXAMPLE] `src/index.ts`. The generic [API-OVERVIEW] page says `0x-version` is "required" and "Requests missing this header may be rate-limited or rejected", but its examples are all EVM (`/swap/allowance-holder/quote`, `0x-version: v2`). **UNVERIFIED whether the Solana endpoints accept/ignore/require it** — the Solana-specific spec omits it. Safe choice: omit (matches every Solana example) or send `0x-version: v2` and confirm with a real key. |
| Chain header / chainId param           | **None.** No chain header or `chainId` exists in the Solana request schema [OPENAPI]. Chain is selected by the `/solana` path prefix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| HTTPS                                  | "All requests must be sent over HTTPS. Requests made over HTTP will be rejected."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [API-OVERVIEW]                                          |
| OpenAPI `security` / `securitySchemes` | absent from the spec (`null`) — the key is modelled as an ordinary required header parameter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [OPENAPI]                                               |

---

## 2. Request parameters — `POST /swap-instructions` body

Verbatim from [REF-SWAP], cross-checked with [OPENAPI] `components.schemas.SwapInstructionsRequest` (`required: ["amount_in","taker","token_in","token_out"]`). Naming is **snake_case** throughout.

| Field                       | Type (REF / OpenAPI)                                                                  | Required | Default                 | Description (verbatim)                                                                                                                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------- | -------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `amount_in`                 | long / `integer, format int64, minimum 1`                                             | yes      | —                       | "Input amount in its base units."                                                                                                                                                                                                                                                                                                                                                                                                                        | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `taker`                     | string                                                                                | yes      | —                       | "Base-58 encoded taker wallet address."                                                                                                                                                                                                                                                                                                                                                                                                                  | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `token_in`                  | string                                                                                | yes      | —                       | "Input token mint, base-58 encoded. Use `So11111111111111111111111111111111111111111` for native SOL."                                                                                                                                                                                                                                                                                                                                                   | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `token_out`                 | string                                                                                | yes      | —                       | "Output token mint, base-58 encoded. Use `So11111111111111111111111111111111111111111` for native SOL."                                                                                                                                                                                                                                                                                                                                                  | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `slippage_bps`              | integer, `minimum 0, maximum 10000`                                                   | no       | `50`                    | "Slippage tolerance in basis points."                                                                                                                                                                                                                                                                                                                                                                                                                    | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `disabled_sources`          | list of string / `array[string]`                                                      | no       | —                       | "DEX sources to exclude from routing. Valid source names are returned by `/enabled-sources`."                                                                                                                                                                                                                                                                                                                                                            | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `reserve_transaction_bytes` | long / `integer int64, minimum 0`                                                     | no       | `0`                     | "Minimum bytes to reserve in the transaction for composing with additional instructions."                                                                                                                                                                                                                                                                                                                                                                | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `swap_fee_ppm`              | string                                                                                | no       | —                       | "Comma-separated volume-based swap fees in parts per million. Must be provided together with `swap_fee_recipient`. Each entry must be between `0` and the per-app maximum (`100_000` unless configured otherwise). A value of `0` disables that fee entry. Multiple fees on the same side are applied sequentially, each on the amount remaining after prior deductions — not the original amount. Fee amounts are rounded up to the nearest base unit." | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `swap_fee_recipient`        | string **or** list of string **or** object; nullable (`oneOf: FeeRecipients \| null`) | no       | —                       | "Fee recipients for the swap fees: either a comma-separated list of existing token accounts, or a structured list mixing addresses with owners whose token accounts should be the fee recipient." Structured form: array of `Destination` (see below).                                                                                                                                                                                                   | [REF-SWAP][OPENAPI] `FeeRecipients` = `oneOf [string, FeeRecipients1]`, `FeeRecipients1` = `array[Destination]` "Structured list of destinations, one per fee entry." |
| `swap_fee_side`             | string                                                                                | no       | (`buy` for every entry) | "Comma-separated fee sides for each fee entry. Supported values are `buy` and `sell`. This field may be omitted only when every fee uses the default `buy` side. When provided, the number of entries must match `swap_fee_ppm`."                                                                                                                                                                                                                        | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `sponsor`                   | string                                                                                | no       | —                       | "Transaction fee payer and rent payer for a fully-sponsored swap. Must differ from the taker and from every native destination in the request. The taker remains the swap authority and must still sign."                                                                                                                                                                                                                                                | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `recipient`                 | string or object; nullable (`oneOf: Destination \| null`)                             | no       | —                       | `Destination` text (see below)                                                                                                                                                                                                                                                                                                                                                                                                                           | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `trade_surplus_cap_ppm`     | integer, `minimum 0, maximum 1000000`                                                 | no       | —                       | "Trade surplus cap in parts per million of the total realized trade size. Must be provided together with `trade_surplus_recipient`, or both fields must be omitted. A value of `0` disables trade surplus collection for the request. When 0x controls trade surplus collection, the request value is ignored and the configured 0x policy is applied instead. The transferred amount is capped relative to trade size."                                 | [REF-SWAP][OPENAPI]                                                                                                                                                   |
| `trade_surplus_recipient`   | string or object; nullable (`oneOf: Destination \| null`)                             | no       | —                       | `Destination` text (see below)                                                                                                                                                                                                                                                                                                                                                                                                                           | [REF-SWAP][OPENAPI]                                                                                                                                                   |

`Destination` schema (used by `recipient`, `trade_surplus_recipient`, and each entry of structured `swap_fee_recipient`) — verbatim [OPENAPI]/[REF-SWAP]:

> "A swap destination: either an existing token account (or wallet for native SOL) address, or an owner whose token account should be used, and created if required. If an account is created, its rent is paid by `sponsor` if present, else by `taker`. If the created ATA belongs to the taker, the sponsor keeps close authority and can reclaim the rent once the account is empty. ATAs created for anyone else (custom recipient, fee or surplus recipient) leave the rent as a permanent sponsor cost."

Object form:

```json
{ "associatedTokenAccount": { "owner": "<base58 owner>" } }
```

`associatedTokenAccount` (object, required) → `owner` (string, required) — "Base-58 encoded owner address that the created token account belongs to." [REF-SWAP][OPENAPI] `AssociatedTokenAccountDestination` / `AssociatedTokenAccountOwner`. Note the **camelCase** key `associatedTokenAccount` inside an otherwise snake_case body — verbatim in both sources.

**Parameters that do NOT exist** in the Solana schema [OPENAPI] (asked about in the brief): no `sellToken`/`buyToken`/`sellAmount` (EVM names), no `swapFeeBps`/`swapFeeToken`, no priority-fee or compute-unit parameter, no `excludedSources` (the Solana name is `disabled_sources`), no `referrer`/`appName`/`affiliate` field, no `sellEntireBalance`, no `chainId`, no `buy amount` / exact-out mode (only `amount_in`). Do not send them.

**Native SOL address convention — discrepancy, flag it:**

- Schema text says use `So11111111111111111111111111111111111111111` (ends `…111`, 43 chars) "for native SOL" [REF-SWAP][OPENAPI] — this is not the WSOL mint.
- Every code example uses the WSOL mint `So11111111111111111111111111111111111111112` (ends `…112`) with the comment `// SOL` [GET-STARTED][REF-SWAP example request][EXAMPLE].
- [EVM-TO-SOL] states: "The address `So11111111111111111111111111111111111111112` is the WSOL mint address, but native SOL is not an SPL token mint account."
- [INTEG-NOTES] says setup instructions may include "1 extra instruction for native SOL support (for certain DEXs)" and that `swap_fee_recipient` "accepts either a wallet address (for native SOL output) or a valid token account address (for token outputs)".
- **UNVERIFIED** whether `…112` is treated as native SOL (wallet lamports, auto wrap/unwrap) or as a WSOL token account swap, and whether `…111` is actually accepted. Must be tested with a real key; the behavioural difference (does the taker need a WSOL ATA? does SOL leave the wallet balance?) is material for a wallet.

Example request, verbatim [REF-SWAP]:

```json
{
  "amount_in": 1000000000,
  "taker": "ZeroEx1111111111111111111111111111111111111",
  "token_in": "So11111111111111111111111111111111111111112",
  "token_out": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "slippage_bps": 50
}
```

Example request from the guide, verbatim [GET-STARTED] (note comment "default is 50 if omitted"):

```js
body: JSON.stringify({
  token_out: 'So11111111111111111111111111111111111111112', // SOL
  token_in: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount_in: 100000000, // Amount of token_in in base units (e.g. 100 USDC)
  taker: takerKeypair.publicKey.toBase58(), // Public key of wallet executing the swap
  slippage_bps: 50, // default is 50 if omitted
});
```

---

## 3. Response shape — `200` from `POST /swap-instructions`

Verbatim [REF-SWAP], matches [OPENAPI] `SwapInstructionsResponse` (`required: ["address_lookup_tables","amount_out","instructions","min_amount_out","route_plan","zid"]`).

| Field                                   | Type                      | Required | Description (verbatim)                                                                                                                          |
| --------------------------------------- | ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `address_lookup_tables`                 | list of string            | yes      | "Address Lookup Table addresses that must be included in the versioned transaction."                                                            |
| `amount_out`                            | long (`int64, minimum 0`) | yes      | "The estimated output amount after fees, in its base units."                                                                                    |
| `min_amount_out`                        | long (`int64, minimum 0`) | yes      | "The minimum output amount after slippage and fees, in its base units. Transaction will fail if this amount is not met."                        |
| `instructions`                          | list of object            | yes      | "The instructions to perform the swap."                                                                                                         |
| `instructions[].program_id`             | list of integer           | yes      | "Program ID as a 32-byte array."                                                                                                                |
| `instructions[].data`                   | list of integer           | yes      | "Serialized instruction data bytes."                                                                                                            |
| `instructions[].accounts`               | list of object            | yes      | —                                                                                                                                               |
| `instructions[].accounts[].pubkey`      | list of integer           | yes      | "Account public key as a 32-byte array."                                                                                                        |
| `instructions[].accounts[].is_signer`   | boolean                   | yes      | —                                                                                                                                               |
| `instructions[].accounts[].is_writable` | boolean                   | yes      | —                                                                                                                                               |
| `route_plan`                            | list of object            | yes      | "List of swap legs comprising the swap."                                                                                                        |
| `route_plan[].amount_in`                | string                    | yes      | "The amount of the input token to swap, in its base units."                                                                                     |
| `route_plan[].amount_out`               | string                    | yes      | "The estimated amount of the output token received from the swap, in its base units."                                                           |
| `route_plan[].dex_address`              | string                    | yes      | "The base-58 encoded address of the DEX."                                                                                                       |
| `route_plan[].dex_label`                | string                    | yes      | "The label for the DEX. Matches labels returned by the `enabled-sources` endpoint."                                                             |
| `route_plan[].dex_program_id`           | string                    | yes      | "The base-58 encoded program ID address of the DEX."                                                                                            |
| `route_plan[].ppb`                      | integer                   | yes      | "Proportion of _remaining_ amount routed through this step in parts per billion."                                                               |
| `route_plan[].token_in`                 | string                    | yes      | "The base-58 encoded address of the input mint."                                                                                                |
| `route_plan[].token_out`                | string                    | yes      | "The base-58 encoded address of the output mint."                                                                                               |
| `zid`                                   | string                    | yes      | "Unique 12-byte hex identifier for this request."                                                                                               |
| `sponsor`                               | string                    | no       | "Present when the caller requested full sponsorship. The returned transaction must use this address as fee payer; both sponsor and taker sign." |

OpenAPI notes: `Instruction` and `AccountMeta` are described as "OpenAPI schema mirror for `solana_instruction::Instruction`" / "`solana_instruction::AccountMeta`" [OPENAPI] — i.e. Rust `solana_instruction` types serialised as raw byte arrays. Type note: `amount_out`/`min_amount_out` are JSON **numbers** (int64) while `route_plan[].amount_in/amount_out` are **strings** [OPENAPI]. In Node, an int64 above 2^53 would lose precision when parsed as a JS number — **UNVERIFIED** whether 0x ever emits such values; parse defensively.

Example response, verbatim [REF-SWAP] (placeholder values):

```json
{
  "address_lookup_tables": ["string"],
  "amount_out": 1,
  "instructions": [
    {
      "accounts": [
        {
          "is_signer": true,
          "is_writable": true,
          "pubkey": [1]
        }
      ],
      "data": [1],
      "program_id": [1]
    }
  ],
  "min_amount_out": 1,
  "route_plan": [
    {
      "amount_in": "string",
      "amount_out": "string",
      "dex_address": "string",
      "dex_label": "string",
      "dex_program_id": "string",
      "ppb": 1,
      "token_in": "string",
      "token_out": "string"
    }
  ],
  "zid": "string",
  "sponsor": "string"
}
```

**What the response does NOT contain** (each asked in the brief, each absent from [REF-SWAP]/[OPENAPI]):

- No serialized transaction (no base64 `VersionedTransaction`, no `swapTransaction`). Only raw instructions + ALT **addresses** (not ALT contents).
- No `blockhash` / `lastValidBlockHeight`. The integrator fetches it [GET-STARTED] §4.
- No fee payer field unless `sponsor` was requested; otherwise the guide sets `payerKey: takerKeypair.publicKey` [GET-STARTED].
- No `fees` object (no integrator-fee amount, no 0x fee, no gas/priority estimate). Fee display is derived client-side from the request values [MONETIZE] "Displaying fees".
- No `liquidityAvailable`, no `issues`, no `expiry`/`validity`/`ttl`, no `price`, no compute-unit estimate, no `simulation` result.
- Response field naming: snake_case. The [EXAMPLE] `src/schema.ts` zod schema expects `amountOut` (camelCase) — that is **stale** relative to the docs; the same repo's commit message says it was updated to snake_case, but `schema.ts` still reads `amountOut`. Trust [REF-SWAP]/[OPENAPI] (`amount_out`).

---

## 4. Integrator responsibilities ("Important Integration Notes")

Verbatim/near-verbatim from [INTEG-NOTES] unless noted.

**Instructions grouping** — "We currently return **a single flat array of instructions.**"

Included:

- "**Setup Instructions (N):** These create associated token accounts (ATAs) for the user (`taker`) as needed. This uses `createIdempotent`, so instructions won't fail if an ATA already exists. The number of instructions (`N`) depends on how many tokens the route involves, sometimes there may be 1 extra instruction for native SOL support (for certain DEXs)."
- "**Integrator fee recipient ATAs are not created automatically.** The `swap_fee_recipient` field accepts either a wallet address (for native SOL output) or a valid token account address (for token outputs). If you're collecting fees on a token output, the token account you pass must already exist — 0x will not create it. If it may not exist, add a `createAssociatedTokenAccountIdempotent` instruction for the fee recipient + fee token mint **before** the swap/fee transfer path."
  - Contradiction to flag: [REF-SWAP]/[OPENAPI] (newer schema) says a structured `swap_fee_recipient` entry of the form `{ associatedTokenAccount: { owner } }` means "an owner whose token account should be used, and created if required", with rent paid by `sponsor` else `taker`. So the "0x will not create it" statement from [INTEG-NOTES] appears to apply to the **plain-address** form only. **UNVERIFIED** which is current; the schema is the more recent artefact. Safest for us: pre-create our fee ATAs once (one per fee mint) and pass the token-account address.
- "**Swap Instruction (1):** A single instruction on our **Settler** program to perform the actual swap." Settler program id `Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m` [BYTES].
- "**Cleanup Instructions (as required):** Cleanup instructions are included as needed for the swap route."
- Roadmap: "We're planning to return these in distinct arrays (`setupInstructions`, `swapInstructions`) in a future release." (would be a breaking shape change — pin a parser).

Not included:

- "**Compute Budget Instructions:** You'll need to manually add these if your transaction is complex and might exceed compute limits."

**Execution assumptions** — "All instructions are returned in a single array, and **must be executed in order**. It is the responsibility of the integrator to: Assemble the full transaction (e.g., using `VersionedTransaction`); Add signers; Insert optional instructions (e.g., compute budget or priority fee) if needed."

**Byte budgeting** — "Solana v0 transactions are limited to **1232 bytes**. Each 0x swap transaction reserves a fixed portion of that space. When you add instructions around the swap (compute budget, transfers, close account, referral logic, etc.), you must ensure your serialized transaction remains under the limit." Use `reserve_transaction_bytes` in the request to make 0x leave room [REF-SWAP]; [BYTES] warns "Setting it higher than necessary reduces the quality of routes the API can return. The correct value is best determined experimentally".

**Byte cost formula** [BYTES]: per added instruction `N + M + 3` (N = account refs, M = data bytes); + per new top-level program (Settler 0, ATA Program 0, System Program 31, SPL Token 31, Token-2022 31, Other 32); + per new unique account 32 (or 1 if via an ALT you bring); + 34 per ALT you bring. Worked example: two ComputeBudget instructions (CU limit N=0 M=5 → 8; CU price N=0 M=9 → 12) + ComputeBudget program 32 = **52 bytes**. Free accounts (already in the 0x tx): taker, user token ATAs for buy/sell, token mints, ATA Program, System Program, SPL Token, Token-2022.

**Token support** [INTEG-NOTES]: SPL and Token-2022 both supported; Token-2022 **not** routed when: transfer-fee extension with non-zero fee, transfer-hook with non-null program, or non-transferable extension. Extension present-but-disabled is still routable.

**From the Get Started guide** [GET-STARTED], the client-side steps are:

1. `POST /swap-instructions`.
2. Decode `instructions[]`: `new PublicKey(Uint8Array.from(acc.pubkey))`, `isSigner: acc.is_signer`, `isWritable: acc.is_writable`, `programId` from `program_id` bytes, `data: Buffer.from(ix.data)` → `TransactionInstruction`.
3. Resolve ALTs: "If the quote response includes `address_lookup_tables`, you must: 1. Fetch each lookup table account from RPC 2. Deserialize it into an `AddressLookupTableAccount` 3. Pass the resulting accounts into `compileToV0Message(...)`" — via `connection.getMultipleAccountsInfo` + `AddressLookupTableAccount.deserialize(accountInfo.data)`.
4. `connection.getLatestBlockhash()`; `new TransactionMessage({ payerKey: takerKeypair.publicKey, recentBlockhash, instructions }).compileToV0Message(addressLookupTableAccounts)`; `new VersionedTransaction(messageV0)`; `versionedTx.sign([takerKeypair])`; `sendTransaction`; `confirmTransaction`.
5. Notes: "The transaction must be signed by the **taker** (payer of the swap)"; "You'll need a **funded wallet** that can cover gas (SOL)"; "If you add **extra instructions** (compute budget, unwrap/cleanup, transfers, etc.), be mindful of the **v0 transaction** 1232-byte limit".
6. Simulation: the docs recommend `skipPreflight: false` during development [TROUBLESHOOT]; [EXAMPLE] runs `connection.simulateTransaction(versionedTx, { sigVerify: true })` **after signing** and aborts on `err`. Nothing in the docs says 0x simulates for you at request time; [INTRO] marketing text says "simulation-safe swap instructions" — **UNVERIFIED** what that guarantees.

**Mapping to our backend/wallet split** (derived from the above, not a 0x statement): the backend can do steps 1–3 and message compilation (it needs an RPC read for ALT contents and a blockhash), add ComputeBudget instructions, and hand the wallet an unsigned `VersionedTransaction` (serialized). The wallet signs with the taker key and broadcasts. Nothing in the returned data requires a 0x-side signer — see §7. The blockhash the backend picks will be the one the wallet must sign against; if the wallet re-fetches a blockhash it must rebuild the message (the backend could instead return decoded instructions + resolved ALTs and let the wallet compile — that is a design choice, not a 0x constraint).

---

## 5. Monetization / platform fee

All from [MONETIZE] unless noted.

- Configured **per request** via body fields `swap_fee_ppm`, `swap_fee_recipient`, `swap_fee_side` (optional). No dashboard-side fee config is mentioned.
- Unit: "Fees on Solana are expressed in **parts per million (ppm)**, not basis points. `1000000` ppm = 100%, so a 1% fee is `10000` ppm and a 5% fee is `50000` ppm." (So 1 bps = 100 ppm.)
- Token the fee is paid in: "**`buy`** — the fee is taken from the output token. This reduces the `amount_out` returned in the quote. **`sell`** — the fee is taken from the input token before the swap is routed. This reduces the amount routed into the swap." Default side is `buy` [REF-SWAP]. There is no separate "fee token" parameter — the fee token is always the input or output mint.
- Multiple fees: "Each comma-separated position defines one fee entry", example verbatim:

  ```json
  {
    "swap_fee_ppm": "50000,25000,10000",
    "swap_fee_recipient": "recipient1,recipient2,recipient3",
    "swap_fee_side": "buy,buy,sell"
  }
  ```

  "Fees on the **same side** are applied **sequentially** … two buy-side fees of `50000` and `25000` ppm produce an effective fee of 7.375%, not 7.5%. Each fee amount is rounded up to the next base unit when needed."

- Cap: "`swap_fee_ppm` has a default per-app limit of `100000` ppm (10%). The cap is enforced **per fee entry, not on the combined total**". Higher limits by request to 0x support.
- Fee recipient account must pre-exist when passed as a plain address: "If a fee recipient is the taker's own token account for that side, the fee is treated as absent (not a self-transfer) and is omitted from the quote and the returned instructions." and [INTEG-NOTES] "the token account you pass must already exist — 0x will not create it". For native-SOL output the recipient is "a wallet address". The structured `{ associatedTokenAccount: { owner } }` form claims auto-creation with rent charged to `sponsor`/`taker` [REF-SWAP][OPENAPI] — see §4 contradiction.
- Display: "The fee you charge is fully determined by the values you send in the request … The quote already reflects any buy-side fees: the returned `amount_out` is net of them". No fee amount is echoed back in the response.
- Availability: "Available on all pricing plans."
- **Does 0x take a cut?** Not stated on any Solana page. [MONETIZE] says nothing about revenue share on `swap_fee_*`. The only 0x-side collection mechanism described is **trade surplus**: `trade_surplus_cap_ppm` / `trade_surplus_recipient` — "When 0x controls trade surplus collection, the request value is ignored and the configured 0x policy is applied instead." [REF-SWAP]. Whether 0x collects positive slippage by default on the free tier, and whether volume fees are shared, is **UNVERIFIED** — check dashboard/plan terms (https://0x.org/pricing).

---

## 6. Errors, rate limits, free tier

**Error body shape (OpenAPI)** [OPENAPI] `ApiError`: `{ "code": string (required), "error": string (required), "zid": string (optional) }`, description "API error response body." Declared responses: `/swap-instructions` → `400` "Client error", `500` "Server error"; `/enabled-sources` → `400` "Missing or invalid required header". No 401/403/404/422/429 are declared in the Solana spec.

**Observed live (gateway layer, before the API)** [PROBE], 2026-09-10:

- `GET /solana/enabled-sources` with no key → HTTP **401**, body `{"message":"No API key found in request","request_id":"…"}`
- `POST /solana/swap-instructions` with no key → HTTP **401**, same body shape.
- `POST /solana/swap-instructions` with `0x-api-key: invalid` → HTTP **401**, `{"message":"Unauthorized","request_id":"…"}`

So there are **two error envelopes**: the gateway's `{ message, request_id }` (auth/rate-limit layer) and the API's `{ code, error, zid }`. A client must tolerate both.

**Error code names**: no Solana-specific list exists. [API-ISSUES] is entirely EVM v2 (`issues` object with `allowance`/`balance`/`simulationIncomplete`/`invalidSourcesPassed`; error codes `INPUT_INVALID`, `SWAP_VALIDATION_FAILED`, `TOKEN_NOT_SUPPORTED` (400), `TAKER_NOT_AUTHORIZED_FOR_TRADE` (403), `BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE` / `SELL_TOKEN_NOT_AUTHORIZED_FOR_TRADE` (422), `INTERNAL_SERVER_ERROR` / `UNCATEGORIZED` (500); Gasless adds `SELL_AMOUNT_TOO_SMALL`, `INSUFFICIENT_BALANCE`, `UNABLE_TO_CALCULATE_GAS_FEE`). The Solana response has **no `issues` object** and **no `liquidityAvailable`** [OPENAPI]. Whether the Solana `code` field reuses the EVM names (e.g. `INSUFFICIENT_BALANCE`, `INSUFFICIENT_ASSET_LIQUIDITY`), and how "no route" is reported (400 vs 500, code string), is **UNVERIFIED** — needs a real-key probe with an illiquid pair and with an underfunded taker. [TROUBLESHOOT] only says "Check API response error messages carefully; they often indicate what went wrong."

**Rate limits** [RATE-LIMITS]: "The current limit for the Free Tier of our APIs is approximately 5 Requests Per Second (RPS)." "The 5 RPS is 5 calls across our endpoints"; "per fixed 1 second window"; higher tiers via https://0x.org/pricing (custom plans, no numbers published); usage visible at https://dashboard.0x.org. No separate Solana quota is documented. HTTP status on rate-limit exceed is **UNVERIFIED** (429 not declared in the Solana spec).

**Free tier access** [INTRO]: "in open beta and available to everyone. Get started for free by creating an account at the 0x Dashboard to get a live API key." Monetization "Available on all pricing plans." [MONETIZE].

---

## 7. Signing

- Response contains **instructions only**; nothing is signed. Signing is entirely client-side: `versionedTx.sign([takerKeypair])` [GET-STARTED]; "It is the responsibility of the integrator to: Assemble the full transaction … Add signers" [INTEG-NOTES].
- Required signer without sponsorship: "The transaction must be signed by the **taker** (payer of the swap)" [GET-STARTED]; the guide compiles with `payerKey: takerKeypair.publicKey` and signs with only `[takerKeypair]` [GET-STARTED][EXAMPLE].
- With `sponsor`: "The taker remains the swap authority and must still sign." [REF-SWAP request]; "The returned transaction must use this address as fee payer; both sponsor and taker sign." [REF-SWAP response `sponsor`].
- No 0x co-signer, no server-side signature, no signed-bytes upload endpoint exists in the spec [OPENAPI] (only two paths). "ready-to-sign" [INTRO][API-OVERVIEW] means "unsigned, needs only the taker's signature (plus sponsor if used)".
- Which accounts carry `is_signer: true` inside `instructions[].accounts[]` beyond the taker: **UNVERIFIED** (would need a real response; the docs imply only taker).
- Relevant for us: the backend never needs a key; the wallet signs the exact bytes the backend compiled and broadcasts on its own RPC (`sendTransaction` → `confirmTransaction`), which is what the guide does [GET-STARTED] §4 and "sendTransaction Options" (`maxRetries`, `skipPreflight`).

---

## 8. `GET /enabled-sources`

Verbatim [REF-SOURCES], matches [OPENAPI] `EnabledSourcesResponse`.

- `GET https://api.0x.org/solana/enabled-sources`
- "Returns the list of enabled sources for the calling team." (per-team, i.e. per API key/dashboard config)
- Header: `0x-api-key` (string, required)
- No query parameters.
- `200` "Enabled DEX sources": `sources` (list of string, required) — "List of enabled sources, as DEX labels."
- `400` "Missing or invalid required header" → `ApiError` [OPENAPI].
- Labels here are the same strings used in `route_plan[].dex_label` and accepted in `disabled_sources` [REF-SWAP].

Example response verbatim:

```json
{
  "sources": ["string"]
}
```

No concrete source names are published in the docs — **UNVERIFIED** list; fetch with a real key.

---

## 9. Other facts worth keeping

- Docs tooling [USING-AI]: raw markdown via `.md` suffix; index at https://docs.0x.org/llms.txt; MCP server at `https://docs.0x.org/_mcp/server`; agent skill `npx skills add 0xProject/0x-ai` — inspected: `skills/0x-api/SKILL.md` is **EVM-only** (no Solana content, all examples use `0x-version: v2` and `/swap/allowance-holder/*`); the `0x` CLI (Rust, `github.com/0xProject/0x-cli`) supports `0x swap` on Solana with a keypair and is x402-payable on Solana — not relevant to a server-side integration.
- OpenAPI spec download: `https://docs.0x.org/openapi/solana-swap-apis.json` / `.yaml`, "No API key required to download." [download-open-api-spec page]. Fetched copy saved at `scratchpad/0x/solana-swap-apis.json` (10,107 bytes).
- Priority fees / Jito: docs only mention "For additional protection against MEV, consider integrating with Jito." [EVM-TO-SOL] and "Insert optional instructions (e.g., compute budget or priority fee) if needed" [INTEG-NOTES]. No 0x-side priority-fee or tip parameter.
- Exact-out swaps, quote TTL, price-only endpoint: none exist on Solana [OPENAPI].

---

## 10. Open items to verify with a real API key (cannot be settled from docs)

1. `So111…111` vs `So111…112` for native SOL — which is accepted and what each does to the taker's SOL/WSOL.
2. Whether `0x-version` is required/ignored on `/solana/*`.
3. Error `code` strings for: no route / insufficient liquidity, taker balance too low, unsupported Token-2022 mint, invalid `disabled_sources` entry, fee recipient ATA missing, per-entry fee cap exceeded; and the HTTP status for rate limiting.
4. Whether plain-address `swap_fee_recipient` still requires a pre-existing ATA (per [INTEG-NOTES]) vs the structured `{associatedTokenAccount:{owner}}` auto-create (per [OPENAPI]).
5. Whether 0x collects trade surplus by default on the free tier ("When 0x controls trade surplus collection").
6. Actual `sources` labels and a real `route_plan` sample.
7. Whether any account other than the taker is flagged `is_signer: true`.
8. Practical `reserve_transaction_bytes` value for our added ComputeBudget (+ optional fee-ATA create) instructions — [BYTES] worked example says 52 bytes for CU limit + CU price alone.
