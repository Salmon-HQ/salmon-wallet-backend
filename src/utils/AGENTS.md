# AGENTS.md instructions for `src/utils`

## Responsibility

- genuinely cross-domain helpers used in more than one slice with no
  dependency on chain-specific concerns

## Current contents

- Empty (only this file).

## Rules

- Do not let this folder grow into a general dumping ground.
- A helper that ends up Solana-only belongs under the matching
  `src/*/solana` folder (e.g. `src/resources/solana/content-urls.js`,
  a URL normalizer consumed by the Solana slice).
- A helper that ends up Bitcoin- or Ethereum-only belongs in the
  matching chain slice.
- A helper used by services in `services/shared/` is fine here, but
  prefer explicit per-service helpers when the surface is small.
- Do not re-export everything via an `index.js` barrel; consumers should
  import the underlying file directly. Barrels add maintenance with no
  call-site benefit and make dead-code detection harder.

## Testing

- Add tests next to the helper (`__tests__/<name>.spec.js`) when the
  helper has non-trivial behavior.
