# Implementation Plan: Drop `@solana/spl-token`

**Branch**: `006-drop-spl-token` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-drop-spl-token/spec.md`

## Summary

`@solana/spl-token@0.4.15` is the sole path to `bigint-buffer` (via
`@solana/buffer-layout-utils`). We import four symbols from it across four
files; none touch the vulnerable u64/u128 codecs. Replace them with local
constants and ~15 lines of web3.js-native code (the repo already hand-rolls
the ATA derivation), delete the package, delete the `SECURITY.md` exception.
Golden-vector tests captured **before** the change are the acceptance oracle.

## Technical Context

**Language/Version**: Node 20 (CommonJS), Express 5 on AWS Lambda

**Primary Dependencies**: `@solana/web3.js` 1.98.x (stays), Metaplex umi 1.x (stays); removes `@solana/spl-token`. Zero additions — four symbols do not justify `@solana-program/token`.

**Storage**: N/A

**Testing**: Jest 30, `npm run test:unit`. Existing golden pattern: `src/services/solana/__tests__/burn-master-edition-equivalence.spec.js` (`GOLDEN_BURN_TRANSACTION`, pinned blockhash).

**Target Platform**: AWS Lambda `nodejs20.x`

**Project Type**: web-service

**Performance Goals**: none — removal only; marginally smaller bundle and no native addon build (`bigint-buffer` runs node-gyp at install).

**Constraints**: byte-identical transactions (AGENTS.md: `src/services/solana` is the highest-risk area; public contracts `solana-nft-burn`, `solana-nft-listing`, `multichain-account-balance` unchanged). No `jest.mock` of production internals beyond what already exists.

**Scale/Scope**: 4 source files, 3 spec files (mocks), 1–2 new golden specs, `package.json` + lockfile, `SECURITY.md`, `.claude/skills/service-drift-audit/SKILL.md` prose.

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template; `AGENTS.md` is the binding rule source.

| Gate                                                 | Status                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Solana slice changes focused and test-backed         | PASS — golden vectors captured first; TDD                                            |
| Public contracts preserved                           | PASS — all boundary values are base58/base64 strings; no shape touched               |
| Dependency policy (existing code > stdlib > new pkg) | PASS — reuses `solana-address-service#findAssociatedTokenAddress`; zero new packages |
| Frontend usage check before removing surface         | PASS — nothing removed from the API; package absent from FE                          |
| Never swallow errors                                 | PASS — no error-handling change                                                      |

Post-design re-check: all PASS. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/006-drop-spl-token/
├── plan.md
├── research.md          # kit-migration assessment + why removal is the fix
├── data-model.md        # (not needed — no data shapes change; omitted)
├── quickstart.md
├── contracts/
│   └── unchanged.md     # which public/internal contracts are asserted unchanged
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/services/solana/
├── solana-address-service.js      # + TOKEN_PROGRAM_ID const; drop getAssociatedTokenAddress import; delete getATA if dead
├── providers/das-shared.js        # + TOKEN_2022_PROGRAM_ID const (or import from address-service)
├── nft-transfer-service.js        # getAssociatedTokenAddressSync → findProgramAddressSync (reuse derivation)
├── burn-service.js                # inline createCloseAccountInstruction
└── __tests__/
    ├── burn-master-edition-equivalence.spec.js   # existing golden — must stay green
    ├── burn-edition-golden.spec.js               # NEW golden: edition burn (close-account path)
    ├── nft-transfer-pnft-golden.spec.js          # NEW golden: pNFT transfer incl. off-curve destination
    ├── nft-transfer-service.spec.js              # drop jest.mock('@solana/spl-token')
    └── providers.spec.js                         # drop jest.mock('@solana/spl-token')

package.json / package-lock.json   # npm uninstall @solana/spl-token
SECURITY.md                        # remove bigint-buffer row; "Production" section becomes "none"
.claude/skills/service-drift-audit/SKILL.md   # § "@solana/spl-token + spl-token-registry"
```

**Structure Decision**: constants live in `solana-address-service.js` next to the existing `SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID`; other files import from there (one owner, no duplicated literals).

## Design

### Symbol-by-symbol replacement

| Symbol                                                                          | Used in                                                      | Replacement                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOKEN_PROGRAM_ID`                                                              | `solana-address-service.js:30,87`, `burn-service.js:327,339` | `new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')` exported from `solana-address-service.js`                                                                                                                                                                                                  |
| `TOKEN_2022_PROGRAM_ID`                                                         | `providers/das-shared.js:93`                                 | `new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')` exported from `solana-address-service.js`                                                                                                                                                                                                  |
| `getAssociatedTokenAddressSync(mint, owner, true)`                              | `nft-transfer-service.js:130`                                | `PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID)[0]` — same seeds as `findAssociatedTokenAddress`; the library's `allowOwnerOffCurve=true` only skipped an `isOnCurve` assertion, PDA derivation is identical |
| `createCloseAccountInstruction(account, dest, authority, [], TOKEN_PROGRAM_ID)` | `burn-service.js:334`                                        | `new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{account,w,!s},{dest,w,!s},{authority,!w,s}], data: Buffer.from([9]) })` — `TransactionInstruction` already imported there                                                                                                              |
| `getAssociatedTokenAddress`                                                     | `solana-address-service.js:50` (`getATA`)                    | delete `getATA` if `grep -rn "getATA" src` shows no caller (2026-09-02: none outside the file); otherwise route through `findAssociatedTokenAddress`                                                                                                                                                      |

Expose a small `findAssociatedTokenAddressSync(owner, mint)` in
`solana-address-service.js` and have the existing async
`findAssociatedTokenAddress` delegate to it, so there is one derivation.

### Golden vectors (captured BEFORE touching source)

1. **Edition burn** — extend/add a spec mirroring
   `burn-master-edition-equivalence.spec.js`: fixed owner, mint, token
   account, blockhash; assert `transaction.serialize({ requireAllSignatures:false })` base64.
2. **pNFT transfer** — two cases: on-curve destination and an off-curve
   destination (any PDA). Assert the derived `destinationAta` base58 and, if
   the umi mock allows, the built transaction bytes.
3. Existing `burn-master-edition-equivalence.spec.js` stays untouched and green.

Regenerating a golden to make a diff pass is a bug, not a fix.

### Test mocks

`nft-transfer-service.spec.js`, `providers.spec.js` and
`burn-master-edition-equivalence.spec.js` currently `jest.mock('@solana/spl-token')`.
Remove those mocks; if a test needed a fake ATA, assert against the real
derivation instead (it is pure and deterministic).

## Test plan

RED → GREEN order:

1. Write golden specs against **current** code; run — green (they pin current bytes).
2. Apply source changes one symbol at a time; goldens must stay green after each.
3. Remove `jest.mock('@solana/spl-token')` from the three specs; `npm run test:unit` green.
4. `npm uninstall @solana/spl-token`; `npm ls bigint-buffer` empty; `npm audit --omit=dev` → 0.
5. Update `SECURITY.md` (drop the row; keep the "Already resolved via overrides" bullets — none of them depended on spl-token) and the drift-audit skill prose.
6. CI gate: `format:check`, `lint:check`, `test:unit`, `serverless print --stage local`, hermetic redis.

## Rollout / rollback

- One PR to `main`, normal `prod/vX.Y.Z` tag flow (bump `package.json#version`).
- No env, no migration, no client coordination — contract-invisible.
- Rollback: revert + redeploy previous tag.
- Post-deploy watch (24 h): CloudWatch errors on `/nft/burn` and `/nft/transfer`
  routes **and** wallet-side signing failures — a malformed instruction fails
  at signing, not at our 200.

## Out of scope

- `@solana/web3.js` → `@solana/kit` (see `research.md`: blocked on umi; triggers T1/T2).
- Feature 005 (`spl-token-registry`) — independent; either can merge first.
