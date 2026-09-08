# Implementation Plan: Solana v1 (4096-byte) transactions

**Branch**: `dev-42-prepare-salmon-for-solana-v1-and-4096-byte-transactions` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

## Summary

Backend: opt every RPC reader into v1 and pin `@solana/web3.js` to the first
1.x that reads v1. Frontend (same branch name in `../salmon-wallet-frontend`):
upgrade `@solana/kit` to 8.x, whose codecs decode v1 natively, so the
lookalike guard flips to rejecting v1 on its own; add v1-aware approval
details, size and unsupported-version handling; advertise version `1` in
Wallet Standard. No Salmon-built transaction moves to v1.

## Technical Context

**Backend**: Node 20 CJS · `@solana/web3.js` 1.98.4 → `1.99.0-beta.0` (exact pin + npm `overrides` entry, because `@metaplex-foundation/umi-web3js-adapters` peers on `^1.72.0` and semver excludes prereleases) · Jest 30.
**Frontend**: pnpm monorepo · `@solana/kit` 7.0.0 → 8.2.0, `@solana-program/*` to their kit-8 lines, `pnpm.peerDependencyRules.allowedVersions` bumped to `8` · Vitest.
**References**: https://solana.com/upgrades/larger-transaction-sizes · `@solana/kit` v8.0.0 release notes.

## Decisions

| Decision                                                             | Choice                             | Why                                                                                                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security hotfix on kit 7 first, or go straight to kit 8              | Straight to kit 8, one frontend PR | A hand-rolled `0x81` check would be throwaway; kit 8's decoder is the canonical v1 recognizer.                                                                       |
| Bare-RPC path on web3.js 1.98 (rejects `version: 1` via superstruct) | Pin `1.99.0-beta.0`                | Two-line diff, covered by the suite, blast radius limited to the emergency fallback path. Alternatives (raw JSON-RPC rewrite; leaving the fallback broken) rejected. |
| Build v1 in Salmon                                                   | No                                 | DEV-42 asks for receive/sign only; no flow needs the larger envelope yet.                                                                                            |
| Unknown future versions on `signMessage`                             | Not detected (pinned)              | Any non-ASCII UTF-8 text has a high first byte too; refusing would refuse legitimate messages. Adding a version to Kit must flip the corpus row.                     |
| Wallet Standard type lacks `1`                                       | Cast with comment                  | `@solana/wallet-standard-features` 1.4.0 (latest) and master define `'legacy' \| 0`.                                                                                 |

## Constitution Check (AGENTS.md)

| Gate                                                        | Status                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Bare-RPC path must remain functional                        | PASS — this is what the web3.js pin protects                                         |
| Never 200 with degraded data                                | PASS — no behaviour change on failure paths                                          |
| Public contract unchanged (`solana-transaction-enrichment`) | PASS — same shape; contract bullet gains the v1 reader note                          |
| Tests at nearest layer                                      | PASS — `triton-rpc.spec`, `solana-transaction-service.spec`, `parser.spec` (v1 case) |
| Dependencies justified                                      | PASS — no new package; one version pin                                               |

## Design

### Backend

- `src/services/solana/parser/triton-rpc.js`: `MAX_TX_VERSION = 1`.
- `src/services/solana/solana-transaction-service.js`: `TRANSACTION_CONFIG.maxSupportedTransactionVersion = 1`.
- `package.json`: `"@solana/web3.js": "1.99.0-beta.0"` + `overrides["@solana/web3.js"] = "$@solana/web3.js"`.
- `AGENTS.md`: `solana-transaction-enrichment` contract bullet documents the opt-in and the pin.

### Frontend

- `packages/shared/src/utils/dapp-approval.ts`: `UnsupportedTransactionVersionError`; `buildTransactionFromEncodedMessage` maps kit's version error and asserts the wire size limit; `SolanaTransactionApprovalDetails.transactionConfig` read via `decompileTransactionMessage` for v1.
- `packages/shared/src/blockchain/solana/simulation.ts`: `UndeterminedReason` gains `'unsupported-transaction-version'`.
- `useSolanaTransactionApproval` → `priorityFeeSol`; `DAppTransactionApprovalView` shows a "Priority fee" row; i18n en/es.
- `apps/extension/src/wallet-standard/wallet.ts`: `supportedTransactionVersions: ['legacy', 0, 1]`.

## Test plan

1. Backend: `npm run test:unit` (978 → 979), `lint:check`, `format:check`.
2. Frontend: `pnpm turbo run typecheck lint test`, `pnpm check:i18n`, `pnpm format:check`; `RUN_SOLANA_LIVE=1` live devnet simulation of a 1.8 KB v1 transaction.
3. Pending (needs a funded devnet key): send a real v1 transaction from the approval path and capture its `jsonParsed` response as a backend parser fixture.

## Rollout / rollback

Backend: normal tag flow; no env change. Rollback = revert the pin. Frontend: ships in the next wallet release; `1` is advertised only with the tests above green. Mainnet activation of v1 is external and pending (Agave 4.2).
