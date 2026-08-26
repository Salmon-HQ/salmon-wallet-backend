'use strict';

/**
 * TritonProvider — implements SolanaDataProvider against Triton One.
 *
 * Surface:
 *
 *   - DAS (NFT metadata, getAssetsByOwner, getAsset, getAssetsBatch):
 *     thin axios wrapper over Triton's JSON-RPC URL — same method names as
 *     Helius DAS, same params, same response shape.
 *
 *   - Tx enrichment (getEnhancedTransactions / getEnhancedTransactionHistory):
 *     pulls transactions from Triton RPC and runs them through the local parser
 *     pipeline (`./parser/index.js`). History first pages use Superbank's
 *     single-call `getTransactionsForAddress`; deeper pages and single-tx
 *     fetches use `getSignaturesForAddress` + `getParsedTransaction` (batched).
 *     The parser produces the same enriched-tx shape the Helius Enhanced API
 *     returns, so the downstream resource decorator consumes it without
 *     branching.
 *
 * The provider never reaches into Helius — fallback is the resolver's job.
 *
 * Triton RPC retention is typically ~5 days. For deeper history we'd need
 * Old Faithful (out of scope this PR).
 */

const axios = require('axios');
const { Connection } = require('@solana/web3.js');

const tritonClient = require('../../../infrastructure/triton-client');
const { ProviderNotImplementedError } = require('./solana-data-provider');
const tritonRpc = require('../parser/triton-rpc');
const { parseTransaction } = require('../parser');
const {
  transformDasAsset,
  fetchToken2022NftsByOwner,
  paginateNfts,
  getPagination,
} = require('./das-shared');

const NAME = 'triton';

const MAX_HISTORY_BATCH = 25;

const getRpcUrl = (environment = 'mainnet') => tritonClient.getRpcUrl(environment);

/**
 * Generic JSON-RPC POST against the Triton URL for `environment`, used by all
 * DAS helpers below (getAsset / getAssets / getAssetsByOwner share this shape).
 *
 * @param {string} id - JSON-RPC request id (for correlation in Triton logs).
 * @param {string} method - DAS method name (e.g. 'getAsset').
 * @param {Object} params - Method params.
 * @param {string} environment - Solana environment ('mainnet'|'devnet'|'testnet').
 * @param {{timeout?: number}} [options]
 * @returns {Promise<*>} `data.result` from the JSON-RPC response (undefined on error).
 */
const dasRpc = async (id, method, params, environment, { timeout = 10000 } = {}) => {
  const url = getRpcUrl(environment);
  const { data } = await axios.post(
    url,
    { jsonrpc: '2.0', id, method, params },
    { headers: { 'Content-Type': 'application/json' }, timeout }
  );
  return data?.result;
};

/** DAS getAsset for a single mint. @returns {Promise<Object|null>} Raw DAS asset, or null. */
const dasGetAsset = async (mint, environment) =>
  (await dasRpc('get-asset', 'getAsset', { id: mint }, environment)) || null;

/** DAS getAssets (batch). @returns {Promise<Object[]>} Raw DAS assets, in request order where found. */
const dasGetAssetBatch = async (mints, environment) =>
  (await dasRpc('get-asset-batch', 'getAssets', { ids: mints }, environment)) || [];

/**
 * DAS getAssetsByOwner, non-fungible only (`showFungible: false`), page size
 * capped at 1000.
 * @param {string} ownerAddress
 * @param {string} environment
 * @returns {Promise<Object[]>} Raw DAS asset items (`result.items`), or `[]`.
 */
const dasGetAssetsByOwner = async (ownerAddress, environment) => {
  const result = await dasRpc(
    'get-nfts-by-owner',
    'getAssetsByOwner',
    {
      ownerAddress,
      page: 1,
      limit: 1000,
      // `showNativeBalance` is a Helius extension; Triton's DAS rejects it
      // with -32602 "unknown field" and the error gets swallowed because
      // dasRpc returns `data?.result` (undefined on JSON-RPC error). This
      // would silently empty out every NFT listing in production. Triton
      // already defaults `showNativeBalance` to false, so the omission is
      // a no-op for both providers.
      displayOptions: { showFungible: false },
    },
    environment,
    { timeout: 30000 }
  );
  return result?.items || [];
};

/**
 * The local parser produces the same enriched-tx shape the Helius Enhanced
 * API returns (address-agnostic — fromUserAccount / toUserAccount populated
 * as observed on chain). The downstream resource decorator pivots by the
 * wallet under inspection to build inputs/outputs, so the parser does not
 * need the user address at parse time.
 */
const enrichSignature = async (signature, environment) => {
  const rawTx = await tritonRpc.getParsedTransaction(signature, environment);
  if (!rawTx) return null;
  return parseTransaction(rawTx, { signature });
};

/**
 * Batch variant of `enrichSignature`: fetches all given signatures in one
 * batched RPC call, then parses each. Preserves input order; entries for
 * signatures that could not be fetched come back as `null`.
 * @param {string[]} signatures
 * @param {string} environment
 * @returns {Promise<Array<Object|null>>}
 */
const enrichSignatures = async (signatures, environment) => {
  if (!signatures || signatures.length === 0) return [];
  const rawTxs = await tritonRpc.getParsedTransactionsBatch(signatures, environment);
  return rawTxs.map((rawTx, i) => {
    if (!rawTx) return null;
    return parseTransaction(rawTx, { signature: signatures[i] });
  });
};

/**
 * Parse the full-transaction entries returned by `getTransactionsForAddress`.
 * Each entry is already `getTransaction`-shaped, so we feed it straight to the
 * parser — no per-signature fetch. `slot` / `blockTime` come off the entry;
 * `confirmationStatus` is forwarded when Triton includes it (full mode may
 * omit it, which the FE treats as "finalized assumed" per the enrichment spec).
 */
const enrichFullTransactions = (entries) => {
  return entries
    .map((entry) => {
      const signature = entry?.transaction?.signatures?.[0] || null;
      if (!signature) return null;
      const parsed = parseTransaction(entry, { signature });
      if (!parsed) return null;
      return {
        ...parsed,
        slot: entry.slot ?? parsed.slot,
        blockTime: entry.blockTime ?? parsed.blockTime,
        confirmationStatus: entry.confirmationStatus,
      };
    })
    .filter(Boolean);
};

const provider = {
  name: NAME,

  getRpcUrl,

  /**
   * Fetch + parse a single signature (or array) into the enriched shape.
   * Same call signature as Helius `getEnhancedTransactions`.
   */
  async getEnhancedTransactions(signature, environment = 'mainnet') {
    if (Array.isArray(signature)) {
      return enrichSignatures(signature, environment);
    }
    return enrichSignature(signature, environment);
  },

  /**
   * Page over signatures + enrich. Filters: { before, limit, type }. The `type`
   * filter is server-side on Helius; we don't replicate that — Triton has no
   * type filter, so we return everything and let the FE filter visually.
   */
  async getEnhancedTransactionHistory(address, filters = {}, environment = 'mainnet') {
    const limit = Math.min(parseInt(filters.limit, 10) || 10, MAX_HISTORY_BATCH);
    const before = filters.before || undefined;

    // First page (no cursor): single-call path. `getTransactionsForAddress`
    // returns signatures + full txs in one billed RPC method, replacing the
    // `getSignaturesForAddress` + `getTransaction` (batch) pair. This is the
    // dominant, cacheable hot path (only first pages are cached upstream).
    //
    // Deeper pages keep the signature-cursor path below, so `nextPageToken`
    // stays a signature end-to-end — compatible with the Helius fallback and
    // bare-RPC fallback, which both paginate by signature.
    if (!before) {
      const { transactions } = await tritonRpc.getTransactionsForAddress(
        address,
        { limit },
        environment
      );

      if (transactions.length === 0) {
        return { data: [], meta: { nextPageToken: undefined } };
      }

      const data = enrichFullTransactions(transactions);
      return {
        data,
        meta: {
          nextPageToken: data[data.length - 1]?.signature,
        },
      };
    }

    const signatureInfos = await tritonRpc.getSignaturesForAddress(
      address,
      { before, limit },
      environment
    );

    if (signatureInfos.length === 0) {
      return { data: [], meta: { nextPageToken: undefined } };
    }

    const signatures = signatureInfos.map((info) => info.signature);
    const enriched = await enrichSignatures(signatures, environment);
    const data = enriched
      .map((tx, i) => {
        if (!tx) return null;
        return {
          ...tx,
          // Carry through fields RPC reports separately so consumers can use
          // them without re-querying.
          slot: signatureInfos[i].slot,
          blockTime: signatureInfos[i].blockTime,
          confirmationStatus: signatureInfos[i].confirmationStatus,
        };
      })
      .filter(Boolean);

    return {
      data,
      meta: {
        nextPageToken: signatureInfos[signatureInfos.length - 1]?.signature,
      },
    };
  },

  isTransactionParsed(transaction) {
    return Boolean(transaction?.type && transaction.type !== 'UNKNOWN');
  },

  /**
   * DAS getAsset → wallet-canonical metadata shape.
   */
  async getNftMetadata(mint, environment = 'mainnet') {
    try {
      const asset = await dasGetAsset(mint, environment);
      if (!asset?.content) return null;
      const { metadata, links } = asset.content;
      return {
        name: metadata?.name || null,
        symbol: metadata?.symbol || null,
        image: links?.image || null,
      };
    } catch (error) {
      console.warn(`[triton-provider] getNftMetadata failed for ${mint}: ${error.message}`);
      return null;
    }
  },

  /**
   * DAS getAssets → Map<mint, metadata>.
   */
  async getNftMetadataBatch(mints, environment = 'mainnet') {
    const result = new Map();
    if (!mints || mints.length === 0) return result;

    try {
      const assets = await dasGetAssetBatch(mints, environment);
      assets.forEach((asset) => {
        if (asset?.id && asset?.content) {
          const { metadata, links } = asset.content;
          result.set(asset.id, {
            name: metadata?.name || null,
            symbol: metadata?.symbol || null,
            image: links?.image || null,
          });
        }
      });
    } catch (error) {
      console.warn(`[triton-provider] getNftMetadataBatch failed: ${error.message}`);
    }

    return result;
  },

  /**
   * DAS getAssetsByOwner + Token-2022 enumeration.
   *
   * Token-2022 enumeration deliberately uses the Triton RPC URL rather than
   * `locals.network.config.nodeUrl`, so this leg stays on the same provider as
   * the DAS call above. `nodeUrl` resolves to Triton whenever it is configured
   * (`constants/networks.js` → `solanaNodeUrl`), but it falls back to Helius
   * when it is not, and that split would be invisible here.
   */
  async getNftsByOwner(publicKeyStr, options = {}, locals) {
    const environment = locals.network?.environment || 'mainnet';
    const connection = new Connection(getRpcUrl(environment));
    const { limit, offset } = getPagination(options);

    // DAS errors propagate on purpose. Swallowing them returned an empty
    // list, which reaches the wallet as a successful "you own no NFTs" — and
    // it also hid the failure from the provider resolver, so the Triton ->
    // Helius fallback could never fire for this leg.
    const assets = await dasGetAssetsByOwner(publicKeyStr, environment);
    const dasNfts = assets.map((asset) => transformDasAsset(asset, publicKeyStr));

    const token2022Nfts = await fetchToken2022NftsByOwner(connection, publicKeyStr);
    return paginateNfts([...dasNfts, ...token2022Nfts], limit, offset);
  },

  /**
   * DAS getAsset for a single mint, returning the wallet-canonical NFT shape
   * (owner is read off `asset.ownership.owner` since no owner is passed in).
   *
   * @param {string} mintAddress
   * @param {Object} locals - Express `res.locals`.
   * @returns {Promise<Object|null>} Wallet-canonical NFT shape, or null on
   *   missing asset / error.
   */
  async getNftByMint(mintAddress, locals) {
    const environment = locals.network?.environment || 'mainnet';
    // `null` is reserved for "the indexer has no such asset", which the
    // caller turns into 404 nft_not_found. An indexer failure must not borrow
    // that meaning: telling the owner their NFT does not exist is worse than
    // telling them the lookup failed.
    const asset = await dasGetAsset(mintAddress, environment);
    if (!asset) return null;
    return transformDasAsset(asset, asset.ownership?.owner || null);
  },
};

module.exports = provider;

/** Kept exposed for tests that exercised the pre-parser stub state. */
module.exports.ProviderNotImplementedError = ProviderNotImplementedError;
