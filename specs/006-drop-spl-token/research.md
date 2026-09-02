# Research: Drop `@solana/spl-token` (and why not a kit migration)

Date: 2026-09-02. Verified against this repo's lockfile/source and published
package metadata; sources at the end.

## Decision 1 — Remove the package instead of migrating to `@solana/kit`

**Decision**: delete `@solana/spl-token`; do not start a web3.js → kit migration.

**Rationale**:

- `npm ls bigint-buffer` shows exactly one path:
  `@solana/spl-token@0.4.15 → @solana/buffer-layout-utils@0.3.0 → bigint-buffer@1.1.5`.
  `@solana/web3.js@1.98.4` does not depend on `bigint-buffer` (it uses
  `@solana/codecs-numbers` + `@noble/*`). The premise "kit is the only line
  that drops the advisory" is false for this repo.
- GHSA-3gc7-fjrx-p6mg lists every `bigint-buffer` version as affected, no
  patched release; `npm audit`'s only fix is a semver-major downgrade to
  `spl-token@0.1.8`.
- Live surface is four symbols (`TOKEN_PROGRAM_ID`, `TOKEN_2022_PROGRAM_ID`,
  `getAssociatedTokenAddressSync`, `createCloseAccountInstruction`) plus one
  dead import (`getAssociatedTokenAddress` in `getATA`). None decode a bigint
  field; `createCloseAccountInstruction` emits `data = [9]`.
- Removal is a strict subset of any future kit work — nothing thrown away.

**Alternatives considered**:

- **`@solana-program/token` (kit-native token client)** — a new package for
  four symbols; violates the dependency policy and drags kit types into a
  web3.js-shaped codebase.
- **`npm ci --ignore-scripts`** so the native addon never builds — the
  pure-JS fallback shares the missing bounds checks, `npm audit` still flags
  it, and it changes how every other dependency installs. Rejected.
- **Full kit migration** — see Decision 2.

## Decision 2 — Kit migration: not now; triggers recorded

**Complexity**: XL, 4–7 engineer-days, and **cannot complete today**.

**Blocker (primary)**: Metaplex umi. `umi` core, `mpl-bubblegum` and
`mpl-token-metadata` have no web3.js dependency; it enters solely through
`@metaplex-foundation/umi-bundle-defaults` → `umi-{eddsa,rpc,transaction-factory}-web3js`
→ `umi-web3js-adapters` (peer `@solana/web3.js ^1.72.0`).
`@metaplex-foundation/umi-kit-adapters` (1.5.1, 2026-02-10) exists but is
only the type-conversion primitive — no `umi-bundle-kit`, `umi-rpc-kit`,
`umi-eddsa-kit` on npm. Its peers pin `@solana/kit: 2.x` while kit publishes
8.2.0 (Anza renamed web3.js 2.x → kit and kept bumping the major).

**Secondary**: `getParsedTransaction` returns `bigint` in kit vs `number` in
web3.js for lamports/slots — silent type drift in money-adjacent parser code;
~8 spec files mock web3.js as classes.

**Non-blockers verified**: Jupiter/Helius/Triton handlers use `axios` only;
`src/resources/solana` carries no web3.js types; `@solana/compat` 8.x allows
side-by-side coexistence for a phased plan.

**Precedent**: `../salmon-wallet-frontend/packages/shared` already migrated to
kit ^7 with web3.js demoted to a devDependency used as a golden-byte oracle
(`prepared-transactions.golden.test.ts`). It could finish because it has no
umi. The golden-vector technique is reused here.

**Re-open when either fires**:

- **T1**: Metaplex publishes a kit-native umi bundle (`umi-bundle-kit` or the
  `umi-*-kit` siblings) **and** `umi-kit-adapters` widens its peer past `2.x`.
- **T2**: a security advisory against `@solana/web3.js` 1.x itself, or an
  Anza EOL date for 1.x.

Phased plan if triggered (each phase independently shippable, do not start 3
before T1): (1) read-only RPC — providers, `das-shared`,
`solana-transaction-service`, `solana-address-service`, 1.5 d; (2)
`utils/solana-address.js` → `assertIsAddress`, 0.5 d; (3) umi boundary —
kit-backed eddsa/rpc/transaction-factory, `transaction-serialization`,
`address-lookup-table-service`, 2 d; (4) `burn-service`,
`nft-transfer-service`, web3.js → devDependency, 2 d.

## Decision 3 — Where the constants live

**Decision**: `solana-address-service.js`, next to the existing
`SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID`; other files import from there.

**Rationale**: one owner per literal; `das-shared.js` and `burn-service.js`
already depend on Solana-slice services. Avoids three copies of a base58
string that must be exact.

## Decision 4 — ATA derivation for off-curve owners

**Decision**: `PublicKey.findProgramAddressSync([owner, TOKEN_PROGRAM_ID, mint], ATA_PROGRAM)`.

**Rationale**: `getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve=true)`
in spl-token 0.4.x only _skips_ an `isOnCurve(owner)` assertion when the flag
is true; the derivation itself is the same `findProgramAddressSync`. The repo's
`findAssociatedTokenAddress` already uses these seeds. A golden vector with a
PDA destination proves equivalence.

## Not verified

- Whether `umi-kit-adapters`' `2.x` peers install against kit 8.2.0 (needs a
  scratch install) — irrelevant to this feature.
- Existence of Codama-generated pure-kit clients for `mpl-bubblegum` /
  `mpl-token-metadata` — nothing found; absence of evidence only.

## Sources

- <https://github.com/advisories/GHSA-3gc7-fjrx-p6mg>
- <https://github.com/solana-program/token/issues/56> (closed not-planned)
- <https://github.com/anza-xyz/kit>, <https://solana.com/docs/frontend/web3-compat>
- npm registry metadata: `@solana/spl-token`, `@solana/buffer-layout-utils`,
  `@solana/web3.js`, `@solana/kit`, `@solana/compat`,
  `@metaplex-foundation/umi*`, `@solana-program/token`
- This repo: `npm ls`, `npm audit`, source reads (2026-09-02)
