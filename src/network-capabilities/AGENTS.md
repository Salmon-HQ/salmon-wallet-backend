# AGENTS.md instructions for `src/network-capabilities`

## Responsibility

- declare per-stage feature gating for every network exposed by the API
- one file per `NODE_ENV` stage: `network-capabilities-{develop,local,main,prod}.js`
- the loader is `src/services/shared/network-capabilities-service.js`,
  which selects the file by `NODE_ENV` and merges it with
  `src/constants/networks.js` via
  `src/services/shared/network-catalog-service.js`

## Rules

- The four stage files are **byte-identical today**. They diverge only
  when a feature should be enabled on one stage and not another.
- When adding or removing a network, update **all four** files unless
  you mean to gate it per stage.
- The `enable` array controls FE visibility. A network can exist in
  `src/constants/networks.js` and be absent from every `enable` list —
  the FE never sees it. That is the intended state for code-present /
  not-yet-launched chains (today: Ethereum).
- Sections (`overview`, `token_detail`, `collectibles`, `swap`,
  `exchange`, `transactions`) declare which features are active per
  blockchain. Use `'*'` to mean "all enabled networks", or an explicit
  list of blockchain ids / network ids.
- This folder owns gating data, not behavior. Service / route logic
  belongs elsewhere.

## Adding a chain

1. Add the network ids in `src/constants/networks.js`.
2. Add `BLOCKCHAINS` entry in `src/constants/blockchains.js` (chain
   becomes mountable once `src/routes/<chain>/index.js` exists).
3. **When ready to expose the chain to the FE**, add the network ids
   to the `enable` array of every stage file you want it active in,
   and add the blockchain to the relevant `sections.*.active` /
   `features.*` lists.

## Testing

- Stage selection + capability merging are covered by
  `src/services/shared/__tests__/{network-capabilities-service,network-catalog-service}.spec.js`.
- This folder ships data only; no per-file unit tests.
