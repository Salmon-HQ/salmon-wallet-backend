# Token catalog / price sourcing after 0x, and Jupiter's geo scope for read-only APIs

Research date: 2026-09-10. Sources fetched directly unless marked UNVERIFIED.
Not legal advice.

---

## Q1 — How 0x integrators source token lists + prices

### 1.1 What 0x itself says

- **0x offers no token list and no USD prices on Solana.** The Solana Swap API
  reference documents only `POST /solana/swap-instructions` (params: `amount_in`,
  `taker`, `token_in`, `token_out`, slippage/fee/sponsor options; response:
  `instructions`, `route_plan`, `amount_out`, `min_amount_out`,
  `address_lookup_tables`, `zid`) and `GET /solana/enabled-sources`. No token
  metadata or price fields in any response.
  https://docs.0x.org/api-reference/solana-swap-ap-is/swap/instructions (2026-09-10)
- 0x's own guidance on "which tokens are supported": there is _"no fixed
  'supported tokens' list to download"_; the answer is to _"request an
  indicative price (or a firm quote) for the pair you want"_. Written for EVM;
  no Solana mention.
  https://help.0x.org/en/articles/8260697-how-to-query-which-tokens-are-available-to-be-swapped-through-0x-api (2026-09-10)
- 0x's EVM swap tutorial fetches its token-list UI from CoinGecko
  (`swap-demo-tutorial`: _"fetch token list data from the CoinGecko API"_).
  https://github.com/0xProject/swap-demo-tutorial (via search, 2026-09-10) — UNVERIFIED that the Solana example does the same (repo README returned 404 to fetch; `gh api` also 404 — repo may be private/renamed).
- **0x CLI (`0xProject/0x-cli`, Rust)** does _not_ resolve symbols on Solana at
  all. `src/chain/mod.rs#validate_token_address` requires a base58 32-byte
  mint; `skills/0x-trade/references/tokens.md` ships a hardcoded table of
  "common tokens" (Solana: WSOL `So111…112`, USDC `EPjF…t1v`) and tells the
  agent to _"Verify on a block explorer"_. Error mapping in `src/api/mod.rs`
  maps 0x names `TOKEN_NOT_SUPPORTED`, `SELL/BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE`
  → CLI `TOKEN_NOT_SUPPORTED`. No Jupiter/Helius/CoinGecko calls.
  https://github.com/0xProject/0x-cli (source read via `gh api`, 2026-09-10)
- **Matcha (0x's own app)** on Solana: token safety comes from _"Go+ Security"_
  audit data and Blockaid-style validation per The Block (2025-04-03)
  https://www.theblock.co/post/349429/0x-dex-aggregator-matcha-solana-cross-chain-avoid-memecoin-rug-pulls ;
  Matcha token pages carry the disclaimer _"Information is based on data
  provided by the issuer, CoinGecko, and other third-party information
  sources"_ (search snippet of https://matcha.xyz/tokens/solana/… — page
  returned 429 on fetch, so UNVERIFIED verbatim). Matcha's price/metadata
  backend is not public.

### 1.2 Documented 0x token-support / error behaviour

- **Token-2022 rule (documented, verbatim):** _"Most Token-2022 tokens are
  routable, but we do **not** route a Token-2022 token when any of the
  following extensions are active: A **transfer fee** extension with a non-zero
  fee; A **transfer hook** extension with a non-null (non-default) program
  address; The **non-transferable** extension. Note that the extension merely
  being present does not disqualify a token. A token can carry a transfer fee
  extension configured to zero, or a transfer hook set to the null (default)
  address — these are still routable."_
  https://docs.0x.org/svm/solana-swap-api/troubleshooting.md (2026-09-10)
  (blog context: https://0x.org/post/token2022-solana-api-now-routes-token-extensions, 2026-07-22)
- **`TOKEN_NOT_FOUND` / `TOKEN_HAS_UNSUPPORTED_EXTENSIONS`: NOT documented.**
  Neither string appears in the Solana troubleshooting page, the
  swap-instructions reference (only a 200 is documented), the generic
  `api-issues` page (which lists EVM codes `INPUT_INVALID`,
  `SWAP_VALIDATION_FAILED`, `TOKEN_NOT_SUPPORTED`,
  `BUY/SELL_TOKEN_NOT_AUTHORIZED_FOR_TRADE`, …), the 0x-cli source, or any
  public 0xProject repo (`gh api search/code org:0xProject` → 0 hits for both).
  https://docs.0x.org/docs/introduction/api-issues.md (2026-09-10). Treat the
  two names as observed-but-undocumented; do not depend on their stability.
- **No integrator was found pre-filtering Token-2022 by extension client-side
  for 0x specifically** (UNVERIFIED — nothing found on solana.stackexchange,
  GitHub, or 0x docs). Precedent from a DEX: Orca rejects `NonTransferable`,
  gates `TransferHook` and `PermanentDelegate` behind a "Token Badge", allows
  `TransferFee`. https://docs.orca.so/create/pools/extensions (2026-09-10)
- Client-side detection is straightforward with `@solana/spl-token`:
  `getMint(conn, mint, commitment, TOKEN_2022_PROGRAM_ID)` then
  `getExtensionTypes(mint.tlvData)`, `getTransferFeeConfig(mint)` (check
  `newerTransferFee.transferFeeBasisPoints > 0`), `getTransferHook(mint)`
  (check `programId` non-default), and `ExtensionType.NonTransferable`.
  https://www.solana-program.com/docs/token-2022/extensions (2026-09-10).
  Helius DAS also returns a parsed `mint_extensions` object for Token-2022
  assets, so the same filter can run off the catalog response without an RPC
  round-trip. https://www.helius.dev/docs/das/fungible-token-extension (2026-09-10)

### 1.3 Candidate replacements for Jupiter Tokens v2 + Price v3

Fit score: 5 = drop-in for both catalog+search+verified+price; 1 = poor.

| #   | Source                                                                                                                                                                                                      | Returns                                                                                                                                                                                                                       | Auth / price                                                                                                                                            | Rate limits                                                                                                                                                                                        | Geo / terms                                | Fit                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Jupiter Tokens v2 + Price v3** (current)                                                                                                                                                                  | search by name/symbol/mint; `isVerified`, `tags`, `organicScore`, `audit`, `icon`, `decimals`, `usdPrice`, `tokenProgram`; Price v3 up to 50 ids, omits unreliable prices                                                     | free key at developers.jup.ag/portal; Free = "1 request/second" / 60 rpm, 60-s window; paid $25–$500/mo                                                 | 1 rps free; separate bucket only for `/swap/v2/execute`                                                                                                                                            | see Q2                                     | 5 (only source with search + verified + price in one)                                                                                                                        |
| B   | **Helius DAS** (`getAsset`/`getAssetBatch` with `showFungible`, `searchAssets`/`getAssetsByOwner` with `tokenType:"fungible"`)                                                                              | metadata (name, symbol, image, decimals, token_program), `mint_extensions`, `token_info.price_info {price_per_token, currency}` — _"Prices for verified tokens are returned under token_info.price_info"_; cached up to 600 s | Free: 1M credits/mo, 10 rps, **DAS 2 rps**; Developer $49/mo                                                                                            | as left                                                                                                                                                                                            | no geo restriction found                   | 3 — per-mint metadata+price OK; **no name/symbol search** (`searchAssets` requires `ownerAddress`), no explicit verified flag, "verified" price coverage source undocumented |
| C   | **CoinGecko** `/token_lists/solana/all.json` (tokenlist standard, updates every 5 min, Demo OK) + `/simple/token_price/solana` (≤515 addresses/call; Demo cache 60 s) + `/coins/list?include_platform=true` | Uniswap-style list (address, name, symbol, decimals, logoURI — `chainId: null`); USD price by mint                                                                                                                            | Demo: free, 10k calls/mo, 100/min, **attribution required, no commercial licence**; Analyst $129/mo, 500/min, must display "Data provided by CoinGecko" | as left                                                                                                                                                                                            | none found                                 | 3 — listing on CoinGecko ≈ curation but no `verified` semantics, no organic score, memecoin coverage lags; search must be done locally over the list                         |
| D   | **DexScreener** `/tokens/v1/solana/{addrs}` , `/latest/dex/search`                                                                                                                                          | pair-level `priceUsd`, `liquidity`, `baseToken{symbol,name}`, `info.imageUrl`                                                                                                                                                 | no key, free                                                                                                                                            | documented "60 requests per minute" on profile/boost/meta endpoints; 300 rpm for tokens/pairs/search is reported by third parties (spec file for those endpoints not fetched → PARTIALLY VERIFIED) | ToS not fetched; no commercial terms found | 2 — price yes, no verified flag, no decimals, no token-level catalog                                                                                                         |
| E   | **Birdeye Data Services** (`/defi/price`, `/defi/tokenlist`, token overview)                                                                                                                                | price, token list with liquidity/volume, metadata                                                                                                                                                                             | free key exists; `/defi/price` = 3 CU per request (docs.birdeye.so snippet); plan tables 403/404 on fetch → UNVERIFIED                                  | UNVERIFIED                                                                                                                                                                                         | none found                                 | 3 — decent catalog+price; "verified" not a first-class flag (UNVERIFIED)                                                                                                     |
| F   | **Solscan Pro API v2** (`token/meta`, `token/price`, `token/list`, `token/meta/multi`)                                                                                                                      | metadata incl. price, mcap                                                                                                                                                                                                    | Pro only, from ~$199/mo, 100 CU/request; ToS forbids reselling API content commercially                                                                 | UNVERIFIED specifics                                                                                                                                                                               | none found                                 | 2 — cost                                                                                                                                                                     |
| G   | **Metaplex Token Metadata / Token-2022 metadata on-chain** via RPC                                                                                                                                          | name/symbol/uri/decimals only                                                                                                                                                                                                 | RPC cost                                                                                                                                                | —                                                                                                                                                                                                  | none                                       | 1 — no verified, no price, no search                                                                                                                                         |
| H   | **`@solana/spl-token-registry` / solana-labs/token-list**                                                                                                                                                   | static JSON                                                                                                                                                                                                                   | —                                                                                                                                                       | archived, read-only since 2022-07 (_"this repository will be archived and will receive no more updates"_) https://github.com/solana-labs/token-list                                                | —                                          | 0                                                                                                                                                                            |
| I   | **Phantom / other wallets**                                                                                                                                                                                 | Phantom _"uses the Jupiter strict list as its default token list"_ (third-party blog, UNVERIFIED against Phantom docs)                                                                                                        | —                                                                                                                                                       | —                                                                                                                                                                                                  | —                                          | evidence the market default is Jupiter                                                                                                                                       |

Sources: A https://developers.jup.ag/docs/tokens , https://developers.jup.ag/docs/tokens/token-information , https://developers.jup.ag/docs/price , https://developers.jup.ag/pricing , https://developers.jup.ag/docs/portal/rate-limits ; B https://www.helius.dev/docs/das/get-tokens , https://www.helius.dev/docs/das/fungible-token-extension , https://www.helius.dev/docs/api-reference/das/searchassets , https://www.helius.dev/pricing ; C https://docs.coingecko.com/reference/token-lists , https://tokens.coingecko.com/solana/all.json (live, timestamp 2026-09-10T12:07Z), https://docs.coingecko.com/reference/simple-token-price , https://docs.coingecko.com/reference/coins-list , https://www.coingecko.com/en/api/pricing ; D https://docs.dexscreener.com/api/reference ; E https://docs.birdeye.so/reference/get-defi-price (snippet) ; F https://docs.solscan.io/solscan-api/solscan-pro-api-endpoints.md , https://docs.solscan.io/solscan-api/solscan-api-terms-and-services.md ; I https://solanaforge.app/blog/solana-token-not-showing-in-phantom. All 2026-09-10.

### 1.4 Practical read

- Nobody in the 0x orbit publishes a "use X for your Solana token list"
  recommendation. 0x's stance is "quote the pair and see". Matcha uses
  CoinGecko + Go+ for its own UI.
- The only non-Jupiter combo that covers _catalog + search + logo + price_
  without a paid plan is **CoinGecko tokenlist (cached, local search) +
  CoinGecko `simple/token_price` or Helius DAS `price_info`** — at the cost of
  losing `isVerified`/`organicScore` (CoinGecko listing becomes the de-facto
  "verified" signal) and of CoinGecko's Demo attribution/commercial-use terms
  (Analyst $129/mo is the first commercial tier).
- Helius DAS is the cheapest per-mint metadata+price+`mint_extensions` source
  the backend already integrates, but it cannot power `/ft/search` by name.
- Token-2022 pre-filter for the swap UI: run the three-rule check (fee>0,
  hook program set, non-transferable) either from DAS `mint_extensions` or
  `getMint` + `getExtensionTypes`, and hide the swap button rather than
  waiting for 0x's undocumented error.

---

## Q2 — Does Jupiter's geo restriction reach read-only Tokens v2 / Price v3 use from a backend?

### (a) Which document governs a portal.jup.ag / developers.jup.ag API key

- The sign-in page says: _"By continuing, you agree to our Terms of Service and
  Privacy Policy."_ https://developers.jup.ag/sign-in (2026-09-10). Link
  targets were not resolvable from the HTML (client-rendered); the docs'
  Legal section lists exactly three documents: **SDK & API License
  Agreement**, **Terms of Use**, **Privacy Policy**.
- The **API & SDK License Agreement** states it governs _"access and use of the
  Jupiter Application Programming Interface ('API') and a Software Development
  Kit ('SDK') available through https://developers.jup.ag/portal"_ and: _"This
  Agreement also incorporates Jupiter's Terms of Service and Privacy Policy
  which terms shall also govern your use of the Service. In the event of any
  conflict between this Agreement and the Terms of Service or Privacy Policy,
  the provisions of this Agreement shall prevail."_
  https://developers.jup.ag/docs/legal/sdk-api-license-agreement (page
  lastModified 2026-04-16; source docx dated 16 Oct 2025 in
  https://github.com/jup-ag/docs/tree/main/static/files/legal)
- The **Terms of Use** (source docx 21 Jan 2025; page lastModified 2026-01-26)
  state: _"These Terms of Use and any terms and conditions incorporated herein
  by reference (collectively, the 'Terms') govern your access to and use of
  the Interface."_ Preamble: _"Jupiter, https://jup.ag, a website-hosted user
  interface (the 'Interface') made available by Block Raccoon S.A. The
  Interface is a visual representation of Jupiter protocol (the 'Protocol')…"_
  https://developers.jup.ag/docs/legal/terms-of-use (2026-09-10)
- There is no separate "API Terms" document. So: **License Agreement is
  primary; Terms of Use are incorporated by reference (as "Terms of Service")
  but are drafted for the jup.ag Interface.**

### (b) Exact prohibition wording

Terms of Use §1 _Eligibility_, sub-heading **Prohibited Localities** (verbatim):

> "Jupiter does not interact with digital wallets located in, established in,
> or a resident of the United States, the Republic of China, Singapore,
> Myanmar (Burma), Cote D'Ivoire (Ivory Coast), Cuba, Crimea and Sevastopol,
> Democratic Republic of Congo, Iran, Iraq, Libya, Mali, Nicaragua, Democratic
> People's Republic of Korea (North Korea), Somalia, Sudan, Syria, Yemen,
> Zimbabwe or any other state, country or region that is subject to sanctions
> enforced by the United States, the United Kingdom or the European Union. You
> must not use any software or networking techniques, including use of a
> Virtual Private Network (VPN) to modify your internet protocol address or
> otherwise circumvent or attempt to circumvent this prohibition."

Immediately before it (same §1): _"We reserve the right to limit the
availability of our Interface to any person, geographic area, or jurisdiction,
at any time and at our sole and absolute discretion."_ After it,
**Non-Circumvention**: _"You agree not to access the Interface using any
technology for the purposes of circumventing these Terms."_

- Operative verb: **"interact with digital wallets"**. Not "use the Interface",
  not "access the Services", not "use the API".
- The Terms of Use **never mention "API", "developer", "portal", "integrator"
  or "Licensee"** (grep of the rendered page, 2026-09-10). Every other
  obligation is framed as "use of the Interface".
- Source: https://developers.jup.ag/docs/legal/terms-of-use

### (c) Is the License Agreement (incl. §7.3 screening) scoped to Swap/Ultra or to all APIs?

- Definition §1 (verbatim): _"'Application Programming Interfaces' or 'API'
  means the back-end smart routing algorithm which facilitates the user's
  efficient swapping of digital assets at a variety of third party trading
  venues"_. §2.3: _"There are several formulations and versions of the API
  routing engine, which comprise either (a) the Jupiter Ultra Swap API, and
  (b) the Metis Swap API."_ §2.6: _"Jupiter is solely providing a back-end
  technical service to the Licensee which allows the Licensee to provide
  swap-related services to end users of the Licensee's products or services."_
- **Tokens API and Price API are never named** in the License Agreement. The
  drafted definition of "API" is the swap routing engine. Whether the data
  APIs fall under "the API" at all is therefore itself ambiguous — but the
  agreement is what you accept to get the key that Tokens/Price require.
- §7.3 (verbatim, key part): _"The Licensee shall ensure that the
  offering/provision of the Licensee's Product complies with all applicable
  laws and regulations, including without limitation all consumer protection,
  Know Your Customer (KYC) or Anti-money Laundering (AML) due diligence laws,
  sanctions, anti-money laundering or terrorist financing laws, securities
  laws, payment provider laws, or virtual assets regulations … the Licensee
  shall (a) obtain and maintain in force … all necessary licenses … and (b)
  perform transaction screening and monitoring of all digital wallets
  interacting with the Client's Product, including blocking of sanctioned,
  blacklisted, prohibited, restricted, flagged, illicit, suspicious or
  crime-associated digital wallets, in accordance with prevailing best market
  practice"_. §7.5: on Jupiter's written request, block specific wallets.
- §7.3 is about **sanctioned/illicit wallets and applicable law**, not about
  the ToU's country list; it does not say "United States". §2.5 is the only
  territory-ish rep in the License: _"The Licensee is not identified on, or
  engages in any transactions with any party listed on, any sanctions list
  maintained by … OFAC."_ No "Prohibited Localities" clause exists in the
  License Agreement; governing law is Panama (§14.4).

### (d) Licensee location vs end-user location

- License Agreement: no clause about where the Licensee or its end users are
  located, beyond the OFAC rep (§2.5) and the §7.3 wallet-screening duty.
- Terms of Use §10: _"the Interface shall be deemed to be based solely in
  Panama and … its availability does not give rise to general or specific
  personal jurisdiction in any forum outside Panama."_ §2: _"The Interface
  may not be available or appropriate for use in all jurisdictions. By
  accessing or using the Interface, you agree that you are solely and
  entirely responsible for compliance with all laws and regulations that may
  apply to you."_
- The Prohibited Localities sentence is about **wallets** Jupiter "interacts
  with", i.e. end users' wallets — that is the only place the US appears.

### (e) Attribution for Tokens/Price data

- License §2.3: label the API used — _"if the Licensee uses anything available
  API other than Jupiter Ultra Swap, it would be mandatory to prominently
  state 'Metis'"_. §8.4: _"Subject to clause 2.3 above, you shall ensure that
  the Licensee's Product shall prominently display to end users of such
  product or service the message 'Powered by Jupiter'."_
- Guidelines page: _"When integrating with Jupiter products, you are advised
  to correctly label the APIs used"_; only the self-hosted Metis binary is
  called out; questions to legal@jup.ag.
  https://developers.jup.ag/docs/misc/integrator-guidelines (2026-09-10)
- Tokens and Price doc pages carry **no attribution text**. Read literally,
  §8.4 "Powered by Jupiter" applies to any Licensee's Product; the "Metis"
  label in §2.3 is written for routing output. Third-party summaries claim
  "Jupiter Metis v1" must be used when Token/Price data is combined with Swap
  routing (deepwiki, UNVERIFIED against the primary page).

### (f) Free-key limits / plan terms

- Pricing: Free = _"Unlimited usage"_, _"1 request/second"_, community
  support; Developer $25/mo 25M credits; Launch $100; Pro $500; overage
  *"$1 per million credits"*. https://developers.jup.ag/pricing (2026-09-10)
- Rate-limit page: Free _"1 requests per second"_ / _"60 requests per
  minute"_, 60-second sliding window; only `/swap/v2/execute` has a separate
  bucket (50 rps Free). https://developers.jup.ag/docs/portal/rate-limits
  (2026-09-10). Search snippets also say legacy portal users keep old limits
  free until **30 June 2026** and that Free has no separate Price bucket —
  neither statement is on the current page (UNVERIFIED / possibly stale).
- License §6.1–6.2: Jupiter _"shall charge a subscription fee … This may be a
  fixed fee, infrastructure fee and/or a variable fee based on revenue earned
  by the Licensee"_, details _"notified to you via the API portal"_. §3.2(e)
  forbids usage that _"exceeds reasonable request volume"_; §3.2(g) forbids
  combining API content _"with content obtained through scraping or any other
  means outside the API"_ (relevant if you merge Jupiter data with
  CoinGecko/Helius data in one payload — arguably caught).
- Tokens v2 docs describe the verified list as _"a free public resource for
  the last 4 years"_ integrated _"by many partners … from dexes to wallets to
  screeners"_. https://verified.jup.ag/faq (2026-09-10)

### Plain-language answer

**Is serving `/ft/verified`, `/ft/search` and USD prices from Jupiter to US
users a breach of Jupiter's terms as written? — Ambiguous, leaning "no"
on the text, "yes" on Jupiter's evident intent.**

Why "no" on the text:

1. The only US-specific rule is in the Terms of Use, which by their own words
   govern "access to and use of the Interface" (jup.ag). The prohibition is
   phrased as "Jupiter does not interact with digital wallets located in … the
   United States". A backend that reads token metadata and prices never sends
   Jupiter a wallet address and never causes Jupiter to interact with a
   wallet; nothing in the request identifies an end user at all.
2. The License Agreement — the document you actually accept for the key —
   contains no country list, defines "API" as the swap routing engine, and
   its §7.3 screening duty targets sanctioned/illicit wallets "interacting with
   the Client's Product", which for a read-only catalog/price feed is a null
   set of Jupiter-facing interactions.
3. The Terms of Use never mention the API, developers, or integrators.

Why it is still ambiguous / risky:

1. The License incorporates the Terms of Use as also governing "your use of
   the Service" (= API + SDK). A maximalist reading imports "Jupiter does not
   interact with … United States" wallets into every API product, and a
   wallet app whose users are in the US is the paradigm case Jupiter is
   trying to keep at arm's length. The VPN/non-circumvention language shows
   the intent is to exclude US persons, not merely swap execution.
2. "Interact with digital wallets" is undefined. Displaying a Jupiter
   `usdPrice` next to a US user's balance is arguably not "interacting with"
   the wallet; a regulator- or Jupiter-side view could disagree.
3. §7.3/§7.4 push all compliance risk onto the Licensee and §7.5 lets Jupiter
   demand wallet blocks — so even if the text does not forbid US read-only
   use, Jupiter retains discretionary levers, and the ToU let it "limit the
   availability … to any … geographic area … at our sole and absolute
   discretion".
4. §3.2(g) (no combining API content with outside data) and §8.4 ("Powered by
   Jupiter") are separate compliance exposures the current integration may
   already touch.

Bottom line: the terms, as written, do **not** clearly prohibit a backend from
serving Jupiter token metadata and prices to US users; they clearly prohibit
Jupiter-routed swaps for US wallets, which Salmon has already moved off. The
residual risk is the incorporation-by-reference of an Interface-scoped
country ban into the API licence, resolvable only by (i) asking legal@jup.ag
for written confirmation that Tokens/Price read-only use is not covered by
Prohibited Localities, or (ii) migrating catalog/price to one of the Q1
options (CoinGecko tokenlist + Helius DAS price_info is the closest free-ish
fit; loses `isVerified`/`organicScore`).
