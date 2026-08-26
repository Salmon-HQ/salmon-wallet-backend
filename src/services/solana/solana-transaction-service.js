'use strict';

/**
 * Solana transaction-service orchestration layer.
 *
 * Sits above `providers/` (Triton primary, Helius fallback) and exposes a
 * provider-agnostic API: `getTransactions`. Each returned tx carries a
 * `_source` discriminator — `'enriched'` when the resolver produced a
 * parsed/decorated tx, `'rpc-standard'` when we fell back to a plain
 * `getParsedTransaction`.
 *
 * `loadEnrichment` batches the per-page lookups the decorator needs
 * (token metadata via Jupiter, NFT metadata via DAS) so a page of N txs
 * costs at most one tokens fetch + one NFT-metadata batch.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const solanaProvider = require('./providers');

// Gate the enhanced-tx path through the resolver so the service layer stays
// provider-agnostic.
const { getEnhancedTransactionHistory, getNftMetadataBatch, isEnhancedApiSupported } =
  solanaProvider;
const heliusTransactionResource = require('../../resources/solana/helius-transaction-resource');
const { list: listTokens } = require('./solana-ft-service');
const { loadRpcEnrichment } = require('./solana-rpc-enrichment');

const COMMITMENT = 'confirmed';
const TRANSACTION_CONFIG = {
  commitment: COMMITMENT,
  maxSupportedTransactionVersion: 0,
};

const { buildTokenLookup } = heliusTransactionResource;

// NOTE: deliberately NOT the resource's `collectNftMints` — that one is
// per-transaction, keeps duplicates and falsy mints. This one aggregates a
// whole page, dedupes, and drops falsy mints before the metadata batch call.
const collectNftMints = (transactions = []) => {
  const mints = new Set();

  transactions.forEach((transaction) => {
    (transaction.tokenTransfers || []).forEach((transfer) => {
      if (
        transfer?.mint &&
        (transfer.tokenStandard === 'NonFungible' ||
          transfer.tokenStandard === 'NonFungibleEdition')
      ) {
        mints.add(transfer.mint);
      }
    });
  });

  return [...mints];
};

const hasTokenTransfers = (transactions = []) => {
  return transactions.some((transaction) => (transaction.tokenTransfers || []).length > 0);
};

/**
 * Batch the per-page lookups the decorator (`heliusTransactionResource`)
 * needs across an entire page of transactions, so N transactions cost at
 * most one token-list fetch and one NFT-metadata batch instead of N each.
 * Both lookups are skipped (resolve to empty) when the page has no token
 * transfers / no NFT mints to enrich.
 * @returns {Promise<{tokenLookup: Map, nftMetadataByMint: Map}>}
 */
const loadEnrichment = async (transactions, locals, environment) => {
  const shouldLoadTokens = hasTokenTransfers(transactions);
  const nftMints = collectNftMints(transactions);

  const [tokens, nftMetadataByMint] = await Promise.all([
    shouldLoadTokens ? listTokens(locals) : Promise.resolve([]),
    nftMints.length > 0 ? getNftMetadataBatch(nftMints, environment) : Promise.resolve(new Map()),
  ]);

  return {
    tokenLookup: buildTokenLookup(tokens),
    nftMetadataByMint,
  };
};

/** Decorate one enriched-provider transaction via the resource layer and tag it `_source: 'enriched'`. */
const buildEnhancedTransaction = async (transaction, address, tokenLookup, nftMetadataByMint) => {
  const transformed = await heliusTransactionResource(transaction, address, tokenLookup, {
    nftMetadataByMint,
  });

  return {
    address,
    signature: transaction.signature,
    ...transformed,
    _source: 'enriched',
  };
};

/** Wrap a bare RPC `getParsedTransaction` result and tag it `_source: 'rpc-standard'`. */
const buildRpcTransaction = (address, signature, transaction) => ({
  address,
  signature,
  ...transaction,
  _source: 'rpc-standard',
});

const logEnhancedHistoryFallback = (address, error) => {
  console.error(`Enhanced provider error for address ${address}:`, error.message);
  console.log('Falling back to standard RPC');
};

/** Fetch a paged history through the provider resolver and decorate it. */
const getEnhancedHistory = async (address, filters, locals, environment) => {
  const result = await getEnhancedTransactionHistory(address, filters, environment);

  if (!result?.data) {
    return null;
  }

  if (result.data.length === 0) {
    return {
      data: [],
      meta: { nextPageToken: undefined },
    };
  }

  const { tokenLookup, nftMetadataByMint } = await loadEnrichment(result.data, locals, environment);

  const data = await Promise.all(
    result.data.map((transaction) =>
      buildEnhancedTransaction(transaction, address, tokenLookup, nftMetadataByMint)
    )
  );

  return {
    data,
    meta: result.meta,
  };
};

/**
 * @throws {Error} `'No RPC URL configured for network'` when
 *   `locals.network.config.nodeUrl` is not set.
 */
const getRpcUrlFromLocals = (locals) => {
  const rpcUrl = locals.network?.config?.nodeUrl;

  if (!rpcUrl) {
    throw new Error('No RPC URL configured for network');
  }

  return rpcUrl;
};

const RPC_MIN_PAGE_SIZE = 1;
const RPC_MAX_PAGE_SIZE = 1000;
// Helius Enhanced API rejects `limit` above 100.
const ENHANCED_MAX_PAGE_SIZE = 100;
// ponytail: fixed fan-out ceiling per RPC batch; tune if the node rate-limits.
const RPC_FETCH_BATCH_SIZE = 50;

/**
 * Normalizes a caller-supplied `pageSize` into the range the target accepts,
 * or `undefined` when it is not a usable number.
 * @param {string|number|undefined} pageSize
 * @param {number} [max=RPC_MAX_PAGE_SIZE]
 * @returns {number|undefined}
 */
const clampPageSize = (pageSize, max = RPC_MAX_PAGE_SIZE) => {
  const parsed = parseInt(pageSize, 10);
  if (Number.isNaN(parsed)) return undefined;
  return Math.min(Math.max(parsed, RPC_MIN_PAGE_SIZE), max);
};

/** Runs `fn` over `items` in sequential batches of `size`, preserving order. */
const mapInBatches = async (items, size, fn) => {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return results;
};

/**
 * Bare-RPC transaction history fallback: lists signatures for `address` via
 * `getSignaturesForAddress`, then fetches each transaction individually with
 * `getParsedTransaction`. Used when the enriched provider path is
 * unavailable or unsupported for the current environment; keeps the wallet
 * functional even when Triton and Helius are both down.
 * @returns {Promise<{data: Object[], meta: {nextPageToken?: string}}>}
 */
const getRpcHistory = async (address, filters, locals) => {
  const rpcUrl = getRpcUrlFromLocals(locals);

  const connection = new Connection(rpcUrl, COMMITMENT);
  const publicKey = new PublicKey(address);
  const options = {
    before: filters.pageToken,
    // Clamp rather than forward: `getSignaturesForAddress` rejects a limit
    // outside 1..1000 with an RPC error, which surfaced as a 500 for what is
    // really a bad query param. A non-numeric value falls back to the RPC
    // default, same as before.
    limit: clampPageSize(filters.pageSize),
  };
  const signatures = await connection.getSignaturesForAddress(publicKey, options, COMMITMENT);

  const transactions = await mapInBatches(signatures, RPC_FETCH_BATCH_SIZE, ({ signature }) =>
    connection.getParsedTransaction(signature, TRANSACTION_CONFIG)
  );

  console.log(`[getTransactions] Loaded ${signatures.length} transactions from ${rpcUrl}`);

  const data = signatures.map(({ signature, ...rest }, index) => ({
    address,
    ...rest,
    ...buildRpcTransaction(address, signature, transactions[index]),
  }));

  // Preload the lookups the bare-RPC resource reads (tokens, token accounts,
  // per-tx NFT metadata) so decoration downstream stays I/O-free.
  await loadRpcEnrichment(data, locals);

  return {
    data,
    meta: {
      nextPageToken: signatures.at(-1)?.signature,
    },
  };
};

/**
 * Try the enhanced (provider-resolver) path first; fall through to the RPC
 * path on null result, throw, or when the env is not enhanced-supported.
 */
const withEnhancedThenRpc = async ({ environment, tryEnhanced, runRpc, onError }) => {
  if (isEnhancedApiSupported(environment)) {
    try {
      const result = await tryEnhanced();
      if (result) return result;
    } catch (error) {
      onError(error);
    }
  }
  return runRpc();
};

/**
 * Fetch a page of transactions through the enriched provider resolver,
 * falling back to standard RPC when the enhanced path is unavailable.
 * @param {string} address
 * @param {{pageToken?: string, pageSize?: number|string}} filters
 * @param {Object} locals
 * @returns {Promise<{data: Array<Object>, meta: {nextPageToken?: string}}>}
 */
const getTransactions = (address, filters, locals) => {
  const { pageToken, pageSize } = filters;
  const environment = locals.network?.environment || 'mainnet';
  return withEnhancedThenRpc({
    environment,
    tryEnhanced: () =>
      getEnhancedHistory(
        address,
        {
          before: pageToken,
          limit: clampPageSize(pageSize, ENHANCED_MAX_PAGE_SIZE) ?? 10,
        },
        locals,
        environment
      ),
    runRpc: () => getRpcHistory(address, filters, locals),
    onError: (error) => logEnhancedHistoryFallback(address, error),
  });
};

module.exports = { getTransactions };
