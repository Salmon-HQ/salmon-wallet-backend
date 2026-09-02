# Security Policy

This backend serves a cryptocurrency wallet. Security reports are taken seriously and handled with priority.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report vulnerabilities privately through **GitHub Security Advisories**: go to the repository's **Security** tab → **Report a vulnerability**. Only repository administrators can see the report, and the discussion stays private until a fix ships.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (endpoint, payload, network/stage if relevant).
- Any suggested remediation, if you have one.

You can expect an acknowledgement within a few business days. Please give us a reasonable window to ship a fix before any public disclosure.

## Scope

In scope: everything served by this repository — the HTTP API (`src/`), scheduled jobs, the analytics ingest endpoint, and the deployment configuration checked in here.

Out of scope: the wallet clients (separate repositories), third-party providers this API consumes (Jupiter, CoinGecko, Helius, Triton, StealthEX), and social engineering.

## Known `npm audit` findings (reviewed, not exploitable here)

`npm audit fix --force` is never the answer in this repo — it proposes downgrades (`@solana/spl-token` 0.1.8) and a Serverless major. Instead, findings are fixed with targeted `overrides` in `package.json`, and the ones below are accepted exceptions. Re-review this list whenever a listed dependency changes.

### Production (`npm audit --omit=dev`)

| Advisory                                                                                                                    | Path                                                | Why it is accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bigint-buffer` ≤1.1.5 — [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), high (availability only) | `@solana/spl-token` → `@solana/buffer-layout-utils` | The overflow is in the optional native addon's `toBigIntLE()` when the input length is caller-controlled. Our only use is the `u64`/`u128` layout codecs decoding SPL token account/mint data, which slice a fixed 8/16-byte span before calling it — a hostile RPC response cannot vary the length. No patched release exists and upstream closed the request as not-planned ([solana-program/token#56](https://github.com/solana-program/token/issues/56)); the dependency is gone only in `@solana/kit` 2.x ([anza-xyz/kit#394](https://github.com/anza-xyz/kit/issues/394)). Retired by a future web3.js → kit migration. |

Already resolved via `overrides` (kept here so nobody removes them):

- `cross-fetch ^3.1.8` — `@solana/spl-token-registry` pins `cross-fetch@3.0.6` → vulnerable `node-fetch` 2.6.1. 3.1.x/3.2.x is API-identical. Note the registry package itself is unmaintained (`solana-labs/token-list` archived 2024); replacing it is a separate task.
- `uuid ^11.1.1` under `jayson` and `rpc-websockets` — both call `v4()`/`v1()` with no `buf`, so the advisory (`v3/v5/v6` with caller buffer) was never reachable; the override just silences it. Both still declare `^8.3.2` upstream.
- `bn.js ^4.12.5` under `ethjs-unit` and `number-to-bn` — `mpl-bubblegum` → `merkletreejs@0.3.11` declares `web3-utils` but never imports it, so the 4.x copy is never loaded at runtime.

### Development only (`serverless@3` tree)

Every remaining finding (`tar`, `decompress`, `adm-zip`, `file-type`, `aws-sdk` v2, `uuid`) sits under `serverless@3`, which only runs on developer machines and in the GitHub Actions deploy job — never inside the Lambda bundle. `tar` in particular is only required by Serverless's self-updater, which exits early when the framework is installed locally (as it is here). npm's sole fix is `serverless@4` (see `docs/DEPLOY.md`); until then these are accepted. Serverless v3 stopped receiving security updates in early 2025, so this exception has a shelf life.

## Notes for maintainers

- Private vulnerability reporting is a GitHub feature for **public** repositories. While this repository is private it cannot be enabled; when the repository goes public, an admin must turn it on once under **Settings → Advanced Security → Private vulnerability reporting**.
- Secret handling and rotation live in `docs/DEPLOY.md` (prod secrets are in AWS SSM Parameter Store, never in the repo).
