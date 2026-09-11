# Helius + CoinGecko — terms, limits, coverage for a US-facing Solana wallet backend

Accessed 2026-09-11 unless noted. Quotes are verbatim from the cited page as rendered that day.
Items without a citation are marked UNVERIFIED. Fetch method: WebFetch (HTML→text) or curl.

Context: AWS us-east-1 backend serving token catalog/search + USD prices to a non-custodial wallet
(takes a swap fee) with end users worldwide incl. USA. Candidates: Helius DAS (free key held) and
CoinGecko (Demo key held). Replacing Jupiter Tokens v2 + Price v3.

---

## 1. HELIUS

### 1.1 Documents found

- Terms of Service — https://www.helius.dev/terms — "Last updated: April 24, 2026". Governing law §14: "The laws of the State of Delaware, USA…".
- https://www.helius.dev/terms-of-service → 404. https://www.helius.dev/privacy → renders a product page ("privacy rings"), not a policy. Privacy policy: UNVERIFIED (not located).
- Pricing — https://www.helius.dev/pricing ; Plans — https://www.helius.dev/docs/billing/plans ; Credits — https://www.helius.dev/docs/billing/credits ; Rate limits — https://www.helius.dev/docs/billing/rate-limits ; Billing FAQ — https://helius.mintlify.app/faqs/billing
- DAS docs — https://www.helius.dev/docs/das-api , https://www.helius.dev/docs/das/get-tokens , https://www.helius.dev/docs/das/fungible-token-extension , https://www.helius.dev/docs/das/search , https://www.helius.dev/docs/das/pagination , https://www.helius.dev/docs/faqs/das-api , https://www.helius.dev/docs/api-reference/das/getassetbatch , https://www.helius.dev/docs/api-reference/das/searchassets
- No separate API Terms / AUP / Developer Terms located. The ToS is the only legal text.

### 1.2 Geographic restrictions

- ToS §11 "Sanctions and export policy": "You may not use helius.dev or purchase any Helius service in or for the benefit of a country, organization, entity, or person embargoed or blocked by any government, including those on sanctions lists identified by the United States Office of Foreign Asset Control (OFAC)".
- ToS §18 "Restrictions": "Due to U.S. sanctions, we do not allow customers with I.P. addresses originating in the following regions or countries to create accounts or boot endpoints: Cuba, North Korea, Iran, Syria or Crimea."
- No US restriction anywhere; Helius is a Delaware company (§14). The restriction is on the _customer's_ IP at account creation / endpoint boot, not on end users. Serving US end users: nothing prohibits it. Serving end users in the §18 list "for the benefit of" a blocked person would breach §11 — relevant if the wallet has no geo-gate for OFAC countries.

### 1.3 Commercial use / attribution / redistribution

- No clause restricts the Free plan to non-commercial use. ToS has no "free", "commercial", "production" or "attribution" obligation on the customer.
- Plans doc: "The Free plan is ideal for prototyping and development with 1M monthly credits and 10 RPC req/s." Billing FAQ: "The free plan includes limited credits and request rates suitable for development and testing. For production applications, consider a paid plan for higher limits, staked connections, and enhanced APIs." → guidance, not a contractual bar.
- Redistribution, ToS §7(v): customer shall "not sublicense, lease, sell, resell, rent, loan, distribute, transfer or otherwise allow the use of Helius Products or any services on helius.dev for the benefit of third party". §7(viii): "not modify, copy or make derivative works based on any part of the Helius Products or on helius.dev". Read literally §7(v) targets reselling _access_; displaying derived data (prices, token lists) to your own users is the normal use of the API and not addressed. Caching is not addressed at all. AMBIGUOUS only if the backend exposed Helius responses as a public, unauthenticated pass-through API to third parties.
- Attribution: none required. §2 attribution language concerns user-submitted "Ideas" only.

### 1.4 Rate limits / quotas (docs/billing/plans, rate-limits, credits, pricing page)

| Plan         | $/mo | Credits/mo | RPC rps | DAS & Enhanced rps | sendTransaction | getProgramAccounts |
| ------------ | ---- | ---------- | ------- | ------------------ | --------------- | ------------------ |
| Free         | 0    | 1M         | 10      | 2                  | 1/s             | 5/s                |
| Developer    | 49   | 10M        | 50      | 10                 | 5/s             | 25/s               |
| Business     | 499  | 100M       | 200     | 50                 | 50/s            | 50/s               |
| Professional | 999  | 200M       | 500     | 100                | 100/s           | 75/s               |

- Credit costs (docs/billing/credits): standard RPC "1"; getProgramAccounts "10"; "10" for DAS API — every DAS call incl. `getAssetBatch` and `searchAssets` is 10 credits per _request_ regardless of asset count; Enhanced Transactions "100"; webhook event "1". Extra credits "$5 per million" (autoscaling on Business/Professional by default).
- Free plan at 1M credits = 100,000 DAS calls/month, hard-capped at 2 DAS rps. Billing FAQ: "If you have consumed all of your credits, you won't be able to make new API requests until you have added more credits… Otherwise, a request will result in a 429 max usage reached error."
- Rate-limits doc: "DAS rate limits and RPC rate limits are independent of each other." Over limit → HTTP 429.
- `getAssetBatch`: "up to 1,000 assets in a single request" (api-reference/das/getassetbatch; das-api overview).
- Pagination doc: "DAS API methods return up to 1,000 records per call." Page-based (`page` starts at 1) or keyset (`cursor`, `before`/`after`); keyset "is only supported when sorting by `id`". No documented max page number, but page-based degrades ("the database must traverse the first 1M records" for page 100 at limit 1000... paraphrased in doc).

### 1.5 Data coverage

- Fungible tokens: das-api overview: "Helius extends the DAS API to cover all tokens, including plain SPL tokens (without metadata) and Token-2022 (plus their extensions)." fungible-token-extension: "The options for `tokenType` are: `fungible`, `nonFungible`, `regularNft`, `compressedNft`, `all`." "For backwards compatibility, the behavior is identical to the original DAS when `tokenType` is omitted." (search doc: omitted → "regular and compressed NFTs only — no fungible tokens").
- `token_info` fields (get-tokens, fungible-token-extension): "symbol, supply, decimals, token_program", plus `balance`, `associated_token_address` on owner queries; nested `price_info`: `price_per_token`, `total_price`, `currency` (examples show "USDC").
- Which tokens get `price_info` (faqs/das-api): "Price data is available for the top 10k tokens by 24h volume." get-tokens: "Prices for verified tokens are returned under `token_info.price_info`." Upstream price source: NOT documented anywhere fetched → UNVERIFIED (community lore says Jupiter/Birdeye; treat as opaque).
- Freshness (get-tokens): "Price data from `getAsset` is cached for up to 600 seconds, so it can be up to 10 minutes old."
- `mint_extensions` (fungible-token-extension): "The response includes the `mint_extensions` field if the token uses the Token-2022 program." "Helius supports Token-2022 tokens and parses their extensions." Documented example is `transfer_fee_config` { withheld_amount, newer_transfer_fee{epoch, maximum_fee, transfer_fee_basis_points}, older_transfer_fee{…}, withdraw_withheld_authority, transfer_fee_config_authority }. Other extensions (transfer_hook, permanent_delegate, metadata_pointer…) are mentioned only as "parses their extensions" — field shapes UNVERIFIED; confirm empirically against a known transfer-hook mint.
- `searchAssets` parameters (api-reference/das/searchassets, verbatim list): ownerAddress, tokenType, page, authorityAddress, limit, sortBy, compressed, compressible, delegate, creatorAddress, creatorVerified, grouping, tree, supply, supplyMint, frozen, burnt, isAgent, agentToken, assetSigner, interface, royaltyTargetType, royaltyTarget, royaltyAmount, ownerType, before, after, options. **No `name`, `symbol` or `jsonUri` parameter.** → no text search by name/symbol; you can filter `tokenType: "fungible"` but only by structural fields (owner, authority, creator, supply, interface…). It cannot implement a "search token by name" box.
- `getAssetBatch` returns `token_info.symbol/decimals/supply/price_info` for fungible mints (api-reference/das/getassetbatch; `showFungible` display option documented on that page).

### 1.6 Other unsuitability notes

- No name/symbol search (above) → Helius cannot be the ONLY source for wallet token _search_; it is a fine per-mint enrichment source (metadata, decimals, Token-2022 extensions, price for top-10k tokens).
- `price_info` only for "top 10k tokens by 24h volume", up to 10 min stale; no market cap / 24h change / verified flag. No "verified"/community list signal at all — Jupiter's `verified` tag has no Helius equivalent.
- Free plan 2 DAS rps is a hard ceiling for any user-facing fan-out; Developer ($49) → 10 rps.
- No published privacy policy located; no DPA. For a wallet backend that only sends mint addresses this is low-risk but UNVERIFIED.

---

## 2. COINGECKO

### 2.1 Documents found

- API Terms of Service — https://www.coingecko.com/en/api_terms — "Latest Version: 5 Sept 2025". Governing law §13.1: "…shall be governed by the laws of the Republic of Singapore."
- Site Terms — https://www.coingecko.com/en/terms — "Latest Version: 12 August 2025" (covers the website; API is carved out to the API Terms).
- Excluded Countries — https://landing.coingecko.com/excluded-countries/ → 301 → https://support.coingecko.com/hc/en-us/articles/51759637961881-Excluded-Countries-List (article updated 2026-09-08; fetched via Zendesk JSON API).
- Pricing — https://www.coingecko.com/en/api/pricing ; Attribution guide — https://brand.coingecko.com/resources/attribution-guide (fetched as .md) ; Commercial vs custom license — https://support.coingecko.com/hc/en-us/articles/16760512207257 (updated 2026-05-25).
- Docs: https://docs.coingecko.com/docs/errors-and-rate-limits , https://docs.coingecko.com/demo/reference/authentication , https://docs.coingecko.com/reference/token-lists , https://docs.coingecko.com/demo/reference/token-lists , https://docs.coingecko.com/reference/simple-token-price , https://docs.coingecko.com/reference/api-usage
- Privacy policy: not fetched (not needed for the questions asked) — UNVERIFIED.

### 2.2 Geographic restrictions

- API Terms §11.2: "you hereby represent and warrant to CoinGecko that you, your entity and any personnel and officer thereunder are not under any sanctions by any authorities (including without limitation the U.S. Department of the Treasury's Office of Foreign Assets Control (OFAC)) nor ordinarily resident nor domiciled in any of the countries listed on https://landing.coingecko.com/excluded-countries/ ("Excluded Countries")."
- Site Terms §1.1: "…you represent that you are above 18 years of age… and are not a resident, domiciled in or accessing the Site from any jurisdiction that is subject to sanctions by any governmental authority (including but not limited to the U.S. Department of the Treasury's Office of Foreign Assets Control (OFAC)) as listed as an Excluded Country…"
- Excluded Countries list (verbatim, 2026-09-08): Afghanistan, Belarus, Burma/Myanmar, Central African Republic, Cuba, Congo, Ethiopia, Iran, Iraq, Lebanon, Libya, Mali, Nicaragua, North Korea, Russia, Somalia, South Sudan, Sudan, Syria, Venezuela, Yemen, Zimbabwe, "3 regions of Ukraine (Crimea, Donetsk, Luhansk)". Page: "CoinGecko reserves the right in its sole discretion to update, amend, add to, and/or delete from the above-stated list… without any notice". "These terms relating to Excluded Countries shall take precedence over any other conflicting provisions".
- United States is NOT on the list. The warranty binds the _API customer_ (you, your entity, personnel), not your end users. No export-control clause beyond OFAC reference. Nothing restricts serving US end users.

### 2.3 Commercial use / attribution / redistribution

- Demo plan and commercial use: pricing page plan table shows "Commercial" (linked to data-license) on Basic/Analyst/Lite and only "Attribution required" on Demo. Support article: "This standard license is included with our Basic, Analyst, Lite, and Pro plans." → **Demo carries no commercial license.** The API Terms themselves have no "Demo"/"non-commercial" clause; §4.1.1 delegates scope to the pricing page: "The scope of use that is granted by our licence to you hereunder this API Terms will be dependent on the usage plan that you select, pursuant to each usage plan's corresponding description as set forth at https://www.coingecko.com/en/api/pricing". So a swap-fee-taking wallet on a Demo key is outside the licensed scope. Minimum compliant tier: Basic ($35/mo, $29 yearly).
- §4.1.6: "You are entitled to charge for your services and products that incorporate or integrates our CoinGecko API. However, you are not permitted to sell, rent, lease, sub-license, re-distribute or syndicate access to the CoinGecko API or part thereof (unless pursuant to the terms of an Executed Agreement…)". Support article: Custom (Enterprise) license needed for "Data Redistribution: Passing raw API data directly to third parties." and "White Labeling: Removing CoinGecko attribution from your product." Displaying prices/token names inside your own wallet UI is the licensed use; proxying the raw token list JSON unchanged to the app is arguably "passing raw API data" — reshape it through `src/resources` (already the repo's contract layer) rather than relaying verbatim.
- Attribution, §4.3 (API Terms): "you shall duly attribute ownership of the CoinGecko API to CoinGecko by displaying prominently the message 'Powered by CoinGecko' in a legible font (an example of a legible font type being 'Arial') no smaller than font size 10." Pricing page / support article: "Your product shall prominently display the message 'Data provided by CoinGecko' and include a hyperlink to https://www.coingecko.com/en/api". Brand attribution guide accepts any of: "Data provided by CoinGecko", "Price data by CoinGecko", "Source: CoinGecko", "Powered by CoinGecko API" (each hyperlinked to coingecko.com or /en/api); "Ensure that the attribution is placed in a visible location, close to where the data is displayed, i.e. above or below the data set." Logo: download from Brand Kit, do not modify, hyperlink required. §4.4: "You are not permitted to use the CoinGecko Brand in a manner that may mislead or suggest that your Products… is endorsed, sponsored by or howsoever associated with CoinGecko." → the wallet UI needs a visible, linked "Data provided by CoinGecko" near prices/search results (frontend change, not just backend).
- Caching / storage, §6.1: "We do not encourage caching or storage of Data. However, if you must cache or store Data: You should refresh the cache at least every 24 hours; Strong encryption and other security measures should be applied to stored Data; When a User requests that you delete all User Data… you must promptly delete…"; on termination delete cached data. §6.2: "Except as expressly permitted hereunder this API Terms, you are not allowed to duplicate, reproduce, copy, store, derive from or translate any Data, API Documentation, or any information expressed by the Data." "Data" is defined broadly (coin info, market data, coin searches). → Redis caching of the token list / prices is tolerated under §6.1 if TTL ≤ 24h; building a persistent derived catalog beyond a cache is on thin ice under §6.2 ("derive from"). Keep it a TTL cache.
- Rate limits may change unilaterally, §4.2: "Such rate limit or monthly call limit may be varied by CoinGecko at any time in its sole discretion without notice or reference to you."

### 2.4 Rate limits / quotas (pricing page 2026-09-11)

| Plan       | $/mo (yearly) | Calls/mo  | Rate/min | Freshness     | License          |
| ---------- | ------------- | --------- | -------- | ------------- | ---------------- |
| Demo       | 0             | 10,000    | 100      | "from 60 sec" | attribution only |
| Basic      | 35 (29)       | 100,000   | 300      | from 60 s     | Commercial       |
| Analyst    | 129 (103.2)   | 500,000   | 500      | "from 10 sec" | Commercial       |
| Lite       | 499 (399.2)   | 2,000,000 | 500      | real-time     | Commercial       |
| Enterprise | custom        | custom    | custom   | real-time     | Custom           |

- Pricing FAQ: "The Demo API plan is accessible to all CoinGecko users at zero cost, with a stable rate limit of 100 calls/min and a monthly cap of 10,000 calls." (An older support article, updated 2026-06-02, still says Demo = "30 calls per minute"; pricing page + docs errors page say 100 — pricing page governs per §4.2.)
- Credit accounting (reference/authentication): "Each successful request (HTTP 200) deducts 1 credit from your monthly quota." Errors don't consume credits but "All requests count toward your per-minute rate limit — including 4xx and 5xx errors" (errors-and-rate-limits). Error 10005 = "Plan Restricted"; 10002 = wrong host for key type. Demo base URL `https://api.coingecko.com/api/v3/`, header `x-cg-demo-api-key`; Pro `https://pro-api.coingecko.com/api/v3/`, header `x-cg-pro-api-key`.
- `/token_lists/{asset_platform_id}/all.json` = 1 call per fetch; available on Demo (demo/reference/token-lists page exists; keyless curl returned error 10005 "limited to Demo and PRO API subscribers"). Cache: "Every 5 minutes".
- `/simple/token_price/{id}` = 1 call per request; "Maximum of 515 contract addresses per request." Cache: Paid "Every 20 seconds", Demo/Keyless "Every 60 seconds". Returns `usd`, `usd_market_cap`, `usd_24h_vol`, `usd_24h_change`, `last_updated_at` per address (optional flags). Unlisted addresses are simply absent from the response object (doc does not state this explicitly → behaviour UNVERIFIED but consistent with the example schema).
- Demo budget math: 10,000/mo ≈ 333/day. Token list every 5 min = 288 calls/day alone. Prices for a 515-mint batch every 60 s = 1,440/day. Demo cannot sustain even a cached prod workload; Basic (100k/mo ≈ 3,333/day) covers list@5min + one 515-batch price refresh every ~60 s only if ≤ ~3 price batches/min. Analyst/Lite needed for per-user on-demand price lookups.

### 2.5 Data coverage

- Token list schema (reference/token-lists): top-level `name` ("CoinGecko"), `logoURI`, `keywords`, `timestamp`, `version{major,minor,patch}`, `tokens[]{chainId, address, name, symbol, decimals, logoURI}` — Uniswap token-list standard. **No "verified"/quality/tag field; inclusion is the signal**: "A token is only included if its contract address has been added by the CoinGecko team." "To request a missing token, submit a request" (support). Refresh "Every 5 minutes". Token count for `solana`: could not fetch (no Demo key in local `.env`; keyless is 10005) → UNVERIFIED; expect low thousands, i.e. only CoinGecko-listed coins, not the long tail.
- `chainId` for Solana in this standard is a placeholder (EVM-centric schema) — verify value before relying on it. UNVERIFIED.
- No Token-2022 extension data, no transfer-fee/hook info, no supply/decimals beyond `decimals`, no on-chain freshness guarantee (list "Every 5 minutes", prices 20–60 s).

### 2.6 Other unsuitability notes

- Coverage gap is structural: new / unlisted / long-tail mints are absent from both the list and `simple/token_price` until CoinGecko staff list the coin. A wallet whose users paste a fresh pump.fun mint gets nothing (Jupiter Tokens v2 covered these via on-chain indexing). Needs a fallback (Helius `getAssetBatch` for metadata; on-chain/DEX price for unlisted).
- Demo is contractually non-commercial and quota-starved; the first compliant tier is Basic and it still needs the frontend attribution string + link.
- §6.2 "derive from" makes a persistent, enriched, backend-owned catalog (merging CoinGecko rows with other sources, stored beyond 24h) legally grey — keep CoinGecko data as a ≤24h TTL cache layer, not a canonical store.
- Terms changeable without notice (§4.2 limits; Excluded Countries page). Singapore law.

---

## 2b. TRITON ONE (already paid; `TRITON_RPC_URL` = shared mainnet endpoint on `*.rpcpool.com`)

### 2b.1 Documents found

- Docs: https://docs.triton.one/digital-assets-api/introduction , …/digital-assets-api/fungible-assets , …/digital-assets-api/metaplex-digital-assets-api (method index), …/metaplex-digital-assets-api/search-assets , …/get-assets , https://docs.triton.one/core-features/ratelimits , https://docs.triton.one/account-management/api-access/rate-tiers
- Product/pricing: https://triton.one/products/metaplex-das , https://triton.one/pricing , blog https://blog.triton.one/the-end-of-the-black-box-why-rpc-pricing-needs-radical-transparency-2/ ("Updated 3 Jun 2026")
- Legal: https://triton.one/policies (single page "Terms of Use, Privacy, and Cookie Policies"; entity "Triton One Limited"). Only the Privacy Policy body renders server-side; the Terms of Use body is loaded client-side and could not be retrieved (`/terms` 404, `/terms-of-service` 521, Wayback blocked). **Terms of Use text: UNVERIFIED.**
- Live probes (2026-09-11, read-only JSON-RPC against our own endpoint) are cited as "probe".

### 2b.2 DAS availability + fields

- Introduction: "The DAS API is enabled by default on all our shared and dedicated endpoints." Coverage: "regular and programmable NFTs, compressed NFTs, MPL Core, fungible tokens, and metaplex agent tokens". "The DAS API is billed on a per-request basis ($50 per million requests)."
- Method index (verbatim names): getAsset, getAssets, getAssetProof, getAssetProofs, getAssetSignatures, getAssetsByAuthority, getAssetsByCreator, getAssetsByGroup "[TEMPORARILY DISABLED]", getAssetsByOwner, searchAssets, getNftEditions, getTokenAccounts, getTokenLargestAccounts. Batch method is documented as `getAssets`; probe: the Helius alias `getAssetBatch` is also accepted.
- Fungible Assets page: "The DAS API indexes all mints and token accounts for the Solana Token Program and Token Extensions Program." Example `token_info`: `symbol, balance, supply, decimals, token_program, associated_token_address`. "The DAS API supports Token22 tokens and their extensions. The response includes the `mint_extensions` field when applicable." Example shows `transfer_fee_config`.
- **No `price_info` anywhere.** GitBook ask-query on the docs: "That page does **not** document any token price fields like `price_info`". Probe `getAsset`/`getAssetBatch` with `displayOptions.showFungible:true` for USDC and JitoSOL: `token_info = {supply, decimals, token_program, mint_authority, freeze_authority}`, `has price_info: False`. `searchAssets` by owner, `tokenType: "fungible"`: `price_info` = None on every item. Product page: no mention of prices, token lists or name search.
- Probe (PYUSD, Token-2022): `mint_extensions` returned `metadata{uri,name,symbol,update_authority,additional_metadata}`, `transfer_hook{authority, program_id}`, `metadata_pointer`, `permanent_delegate`, `transfer_fee_config{…}` → Token-2022 extension detection (transfer fee, transfer hook, permanent delegate) works today on the paid endpoint. Name/symbol/logo come from `content.metadata` + `content.links.image` (USDC image resolved to the legacy solana-labs token-list logo).
- Probe: `getAssetBatch` **without** `showFungible` returned `[null]` for USDC — must pass `displayOptions.showFungible: true` for fungible mints. Max ids per `getAssets`: not documented (UNVERIFIED; Metaplex reference is 1,000).

### 2b.3 Search

- searchAssets doc params (verbatim table, sourced from Metaplex reference): negate, conditionType, interface, ownerAddress, ownerType, creatorAddress, creatorVerified, authorityAddress, grouping, delegateAddress, frozen, supply, supplyMint, compressed, compressible, royaltyTargetType, royaltyTarget, royaltyAmount, burnt, sortBy, limit, page, before, after, jsonUri. Prose says filters "such as asset name" but no `name` param is in the table.
- Probe `searchAssets {name:"Jito", tokenType:"fungible"}` → `-32000 "Validation Error: Owner address must be provided in order to search assets by name"`. So a `name` filter exists but only scoped to one owner — useless for a global token-search box.
- Probe `limit: 1001` → `"Pagination Error. Limit should not be greater than 1000."` → max page size 1,000.

### 2b.4 Geographic / commercial terms

- Terms of Use body not retrievable → sanctions/US/export clauses UNVERIFIED. Privacy Policy (rendered) has no geographic clause. Entity is "Triton One Limited" (jurisdiction of incorporation not stated on page — UNVERIFIED). Nothing public suggests a US-end-user restriction; Triton markets "Wallets, custodians and portfolio trackers" as a use case (site footer). Ask Triton support for the ToS PDF before relying on this.

### 2b.5 Pricing / rate limits

- Pricing page: "Standard RPC, unary gRPC, account, and ledger queries: $0.08 / GB bandwidth + $10 / million calls"; "Metaplex API: $0.08 / GB bandwidth + $50 / million calls"; "Minimum deposit is $125, usable across all services… prepaid, non-refundable, and valid for 12 months." Blog: "Triton's connection limits, RPS, and unit costs are the same on every subscription".
- Rate limits doc: "Rate limits are primarily based on your originating IP address"; "The standard limit for most methods is **1200 requests per 10 seconds** per IP"; on 429 "you **must pause all requests from that IP for 10 seconds**"; "Computationally expensive methods, such as `getProgramAccounts`, have significantly lower limits"; per-endpoint limits at `https://<your-endpoint>.rpcpool.com/ratelimits` (probe: our endpoint answers `403 Access forbidden` on that path — check from an allow-listed IP or the customer portal). Rate tiers named free/tier1/tier2/tier3/dedi; numbers not public. DAS-specific rps: UNVERIFIED (no separate DAS limit documented, unlike Helius).
- Cost comparison for 100k DAS calls/month: Triton $5 + bandwidth; Helius Free $0 (then $49 Developer for 1M calls-equivalent); Helius per-call is 10 credits = $0.05/1k at $5/M-credit autoscale → identical $50/M. Triton has no free tier but no 2-rps DAS ceiling either.

### 2b.6 Verdict — what Triton can replace

- **Catalog metadata per mint (name/symbol/decimals/logo): YES**, via `getAssets`/`getAssetBatch` + `showFungible`, already paid, ~120 rps/IP. Same quality class as Helius `getAssetBatch`.
- **Token-2022 extension detection (transfer fee / hook / permanent delegate): YES**, proven by probe; equal to Helius (Helius docs only _show_ `transfer_fee_config`, Triton probe shows hook + delegate too).
- **USD price: NO.** No `price_info`, no price product. Helius has it for "top 10k tokens by 24h volume" (≤10 min stale); Triton has nothing → prices must come from CoinGecko (listed tokens) or another source.
- **Global token search by name/symbol: NO** (name filter requires `ownerAddress`) — same gap as Helius. Neither replaces Jupiter Tokens v2 search; that needs CoinGecko's curated list (or a self-built index) for the search box.
- Net vs Helius for this job: Triton = Helius minus `price_info`, minus the free tier, plus no separate DAS rate ceiling and one fewer vendor/key. If prices come from CoinGecko anyway, Triton alone covers the enrichment half and Helius becomes optional.

---

## 3. VERDICT

**Helius — safe to serve US users: YES.** The only geographic clauses are ToS §11 (OFAC-embargoed persons/countries) and §18 (customer IPs from Cuba, North Korea, Iran, Syria, Crimea cannot create accounts/boot endpoints); the US is neither, Helius is itself a Delaware entity (§14), and no clause restricts the Free plan to non-commercial use or demands attribution. The decisive limits are technical, not legal: Free = 1M credits (100k DAS calls) at 2 DAS rps with a hard 429 when exhausted; `searchAssets` has no `name`/`symbol` parameter, so Helius cannot be the sole token-search source; `price_info` covers only "the top 10k tokens by 24h volume", is "cached for up to 600 seconds", and its upstream source is undocumented. Residual risk: §7(v) if the backend ever re-exposes Helius responses as a public pass-through API, and the §11 "for the benefit of" language if the wallet has no OFAC geo-gate at all.

**Triton One — safe to serve US users: AMBIGUOUS (terms not retrievable).** No public clause found restricting US or any region, Triton markets wallets as a use case, and we already run production traffic on it; but the Terms of Use body at https://triton.one/policies is client-rendered and could not be fetched, so the deciding clause is unread — get the ToS from Triton support. Technically it replaces the Jupiter metadata + Token-2022 half (probe-verified `getAssetBatch` + `showFungible` returns name/symbol/decimals/logo and `mint_extensions` incl. transfer_hook/permanent_delegate/transfer_fee_config, 1,000 per page, ~120 rps/IP, $50/M DAS calls) but has no price data and no global name search.

**CoinGecko — safe to serve US users: YES on geography, NO on the current Demo key.** US is absent from the Excluded Countries list and §11.2 binds the customer entity, not end users, so geography is clear. What decides suitability is licensing: §4.1.1 ties the licence scope to the pricing page, where the commercial licence is "included with our Basic, Analyst, Lite, and Pro plans" and Demo shows only "Attribution required" — a fee-earning wallet on Demo is outside scope, and Demo's 10,000 calls/month cannot carry a production workload anyway. Compliant path = Basic or higher, plus a visible linked "Data provided by CoinGecko" near the data (§4.3 / brand guide), Redis TTL ≤ 24 h (§6.1), no raw pass-through of the token list (§4.1.6 / support article "Data Redistribution"), and a second source for unlisted mints because the list is curated by staff, carries no quality flag beyond inclusion, and omits the long tail.
