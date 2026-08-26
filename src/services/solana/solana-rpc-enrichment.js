'use strict';

/**
 * Bare-RPC enrichment loader.
 *
 * Counterpart of `loadEnrichment` in `solana-transaction-service` but for the
 * bare-RPC fallback path: it preloads every lookup that
 * `solana-transaction-resource` (the bare-RPC mapper) needs, so the resource
 * stays a pure (data, context) → shape function with no network I/O.
 *
 * Call pattern intentionally mirrors what the resource used to do inline:
 * - token list + token accounts load once per request, lazily (only when the
 *   page has at least one non-enriched tx) and memoized on `locals`
 * - `findNft` is called per transaction, only when that transaction carries
 *   an NFT-mint candidate (inner instruction whose `owner` is the wallet).
 *   No cross-transaction dedupe — same call count as the old lazy path.
 */

const { list: listTokens } = require('./solana-ft-service');
const { find: findNft } = require('./solana-nft-service');
const { getTokenAccounts } = require('./solana-address-service');

/**
 * Returns the first NFT-mint candidate referenced by inner instructions whose
 * `owner` equals `address`. Mirrors the lookup the resource dispatches on.
 */
const getNftMintCandidate = (address, meta) =>
  meta?.innerInstructions?.[0]?.instructions
    ?.map(({ parsed }) => parsed?.info)
    ?.filter((info) => info?.owner === address)
    ?.map((info) => info?.mint)
    ?.filter(Boolean)?.[0];

/**
 * Preloads onto `locals` everything the bare-RPC transaction resource reads:
 * `locals.tokens`, `locals.tokenAccounts` and `locals.rpcNftBySignature`
 * (raw `findNft` result keyed by tx signature). No-op when every transaction
 * is `_source: 'enriched'` (the resource passes those through untouched).
 *
 * @param {Array<Object>} transactions - service-shaped txs (`_source` tagged)
 * @param {Object} locals - Express `res.locals`; mutated as the memoization
 *   point, same as the previous in-resource lazy loading.
 * @returns {Promise<void>}
 */
const loadRpcEnrichment = async (transactions, locals) => {
  const rpcTransactions = (transactions || []).filter(
    (transaction) => transaction && transaction._source !== 'enriched'
  );

  if (rpcTransactions.length === 0) {
    return;
  }

  if (!locals.tokens) {
    locals.tokens = await listTokens(locals);
  }
  if (!locals.tokenAccounts) {
    locals.tokenAccounts = await getTokenAccounts(rpcTransactions[0].address, locals);
  }

  locals.rpcNftBySignature = locals.rpcNftBySignature || {};
  for (const { address, signature, meta } of rpcTransactions) {
    const mint = getNftMintCandidate(address, meta);
    if (mint) {
      locals.rpcNftBySignature[signature] = await findNft(mint, locals);
    }
  }
};

module.exports = { loadRpcEnrichment };
