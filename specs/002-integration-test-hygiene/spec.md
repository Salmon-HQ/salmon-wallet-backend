# Spec 002 — Integration test hygiene

Status: implemented in this branch. Prerequisite for the nightly external
integration workflow (spec 003): before these suites can gate anything, they
must fail only for real reasons.

## What

1. **Real availability probes replace fake env guards.** The Helius and
   Jupiter Price integration specs guarded with
   `expect(process.env.X).toBeDefined()` — but `jest.setup.js` injects dummy
   defaults (`test-helius-key`, `https://jupiter.test/...`) precisely so
   unit tests run hermetically, so the guard always passed and the suites
   then died on DNS/401 instead of skipping. Both now probe the provider
   directly (raw axios, 5 s timeout, NOT through the service under test — a
   service regression must still be able to fail the suite) and skip with a
   logged reason when unavailable, exactly like the existing
   `triton-provider.integration.spec.js` pattern. The Jupiter swap spec
   already had a DNS probe; it now logs why it skips.
2. **Pure-function tests moved to the unit suite.** The
   `isTransactionParsed()` block in the Helius integration spec touches no
   network; mislabeled as integration it never ran in CI. Moved to
   `helius-transaction-service.spec.js` (unit) where the PR gate runs it.
3. **Unfailable tests deleted.**
   - Jupiter "should handle network errors gracefully": reassigned
     `process.env.JUPITER_PRICE_URL` at runtime, but the module reads it
     once at load — the invalid URL was never used, and its try/catch
     accepted both outcomes. It could not fail; it tested nothing.
   - Swap "should handle execute with mock signed transaction": placeholder
     asserting `typeof execute === 'function'`. Real execute() coverage
     needs wallet signing — end-to-end territory, noted in a comment.
4. **Fallback test used a fabricated environment.** The
   `solana-transaction-service` fallback test invented `environment:
'rpc-only'`, which crashed token enrichment ("Unknown slug: rpc-only" from
   spl-token-registry) — production only ever passes
   mainnet/testnet/devnet, so this was a test bug, not a code bug. It now
   uses `testnet` (a real environment the Enhanced API does not support), which
   exercises the same bare-RPC fallback path without inventing state.
5. **`notify: true` removed from jest.config** (desktop-notification noise;
   meaningless in CI) and with it the now-orphaned `node-notifier`
   devDependency.

## Why

The nightly workflow (next batch) runs these suites with real secrets. A
suite that silently passes while asserting nothing, or fails on DNS instead
of skipping, produces exactly the false signal the CI system exists to
eliminate. Probe semantics: provider unreachable → skip with reason (that is
availability, not a code bug); provider reachable + code broken → real
failure.

## Alternatives discarded

- **Tightening the TRUMP/PUMP referral-fee assertions** (they no-op when the
  live router returns no route): left as-is deliberately — asserting on live
  router output would make the nightly flaky for non-code reasons. They are
  informational; the first referral test still asserts fee bounds.
- **Deleting the ethereum skeleton-router spec** (tests that no routes are
  registered): kept — the Ethereum placeholders are intentional future
  surface per AGENTS.md, and the spec documents that intent.
- **nock/msw network-blocking for unit tests**: out of scope here; the unit
  sweep found mocking discipline good (only `sink.spec.js` is one edit away
  from a live GA4 call). Revisit if a real leak appears.

## Addendum (post-merge, validated by the first nightly dispatch)

The first `integration-external.yml` dispatch surfaced two guards this spec
missed — both DNS-only checks that pass while auth fails:

- `solana-transaction-service.integration.spec.js` resolved
  `api-mainnet.helius-rpc.com` via DNS and then 401ed on every call with the
  dummy key. Now probes the Enhanced API with the configured key, same
  pattern as the other suites.
- `solana-ft-swap-service.integration.spec.js` resolved the Jupiter host and
  then failed its referral assertions when keyless `order()` calls returned
  null. Now probes the `/order` endpoint with a real minimal quote (and the
  API key when configured); auth/rate-limit failures skip with a reason.

## Known provider-side failure (documented, not masked)

`triton-provider.integration.spec.js` currently fails against the live
provider: `getTransactionsForAddress failed: Method not found` — the
configured Triton endpoint/plan no longer exposes that proprietary RPC
method (DAS calls still work). This is exactly the drift signal the nightly
workflow exists to surface; it is NOT retried or skipped away here. Action
belongs to ops: confirm the Triton plan/endpoint, or the provider resolver's
Triton path is dead weight in production too.

## Verification criteria

- `npm run test:unit` green, count grows by the 3 moved tests (774 → 777).
- `npm run test:integration` with a real `.env`: helius/jupiter/swap suites
  either run their assertions (provider reachable) or skip with a logged
  reason — no DNS/401 hard failures.
- `npm run test:integration` with NO real provider env (CI conditions):
  everything skips or passes hermetically; nothing hard-fails.
- `npm run lint:check` + hermetic redis suite green.
