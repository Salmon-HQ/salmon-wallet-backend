'use strict';

/**
 * SolanaDataProvider — interface contract that all Solana data providers
 * (Helius, Triton, etc.) must satisfy.
 *
 * The resolver (`./index.js`) wires Triton as primary and Helius as fallback
 * for tx enrichment, and routes DAS calls the same way. Each provider must
 * implement every method below; methods that are not yet supported by a
 * provider must throw `ProviderNotImplementedError` so the resolver can route
 * the call to the fallback chain.
 *
 * The shape returned by each method is the wallet-canonical "enriched" shape
 * documented below. Providers are responsible for converting upstream payloads
 * (Helius enhanced API responses, Triton parsed RPC responses, etc.) into the
 * canonical shape internally — never the resolver.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Enriched transaction shape (return value of getEnhancedTransactions and
 * each item in getEnhancedTransactionHistory.data):
 *
 *   {
 *     // Required identification + ledger metadata
 *     signature:        string,
 *     timestamp:        number,                  // unix seconds
 *     fee:              number,                  // lamports
 *     feePayer:         string,                  // base58 address
 *     transactionError: object|null,
 *     slot?:            number,
 *     blockTime?:       number,
 *
 *     // Required classification (downstream maps these to the 9 FE buckets)
 *     type:             string,                  // canonical Helius-shape type
 *                                                 // e.g. 'TRANSFER' | 'SWAP' |
 *                                                 // 'TOKEN_MINT' | 'NFT_MINT' |
 *                                                 // 'BURN' | 'STAKE_TOKEN' |
 *                                                 // 'COMPRESSED_NFT_MINT' |
 *                                                 // 'UNKNOWN'
 *     source?:          string,                  // 'JUPITER' | 'RAYDIUM' | ...
 *     description?:     string,                  // human-readable line
 *
 *     // Required transfer arrays (post-enrichment, the resource decorator
 *     // pivots these into the 9-bucket inputs/outputs)
 *     nativeTransfers: [{
 *       fromUserAccount: string,
 *       toUserAccount:   string,
 *       amount:          number|string,          // lamports, raw
 *     }],
 *     tokenTransfers:  [{
 *       fromUserAccount: string,
 *       toUserAccount:   string,
 *       fromTokenAccount?: string,
 *       toTokenAccount?:   string,
 *       mint:            string,
 *       tokenAmount:     number|string,          // raw or formatted (toRawAmount handles both)
 *       decimals:        number,
 *       tokenStandard?:  'Fungible'|'NonFungible'|'NonFungibleEdition',
 *       symbol?:         string,
 *       name?:           string,
 *       logoURI?:        string,
 *     }],
 *
 *     // Optional enrichment surface (populated when known)
 *     instructions?:   [{
 *       programId:               string,
 *       innerInstructions?:      object[],
 *       innerInstructionsCount?: number,
 *     }],
 *     events?:         object,
 *     swapRoute?:      object,                   // hops, conversionRate, etc.
 *     innerSwaps?:     object[],                 // multi-hop detail
 *     swapFees?:       object,
 *   }
 *
 * Both providers must produce this same shape so the downstream resource
 * decorator (`heliusTransactionResource`) is provider-agnostic.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * @typedef {object} SolanaDataProvider
 *
 * @property {string} name
 *   Provider identifier — used for logging, metrics, and resolver routing.
 *   Must be unique across providers ('helius', 'triton').
 *
 * @property {(environment: 'mainnet'|'devnet'|'testnet') => string} getRpcUrl
 *   Returns the JSON-RPC URL for the given Solana environment. Used by
 *   services that need a raw RPC connection (web3.js Connection,
 *   getParsedTokenAccountsByOwner, etc.).
 *
 * @property {(signatures: string|string[], environment: string) =>
 *            Promise<object|object[]|null>} getEnhancedTransactions
 *   One-shot enrichment: takes a signature or array of signatures and returns
 *   the enriched transaction shape (see header). When a single signature is
 *   passed, returns a single object (or null when not found); when an array
 *   is passed, returns an array preserving order.
 *
 * @property {(address: string, filters: object, environment: string) =>
 *            Promise<{data: object[], meta: {nextPageToken?: string}}>}
 *   getEnhancedTransactionHistory
 *   Paginated history for a wallet. Filters: `{ before?, limit?, type? }`.
 *
 * @property {(transaction: object) => boolean} isTransactionParsed
 *   Returns true when the provider was able to classify the transaction
 *   (type !== UNKNOWN).
 *
 * @property {(mint: string, environment: string) =>
 *            Promise<{name, symbol, image}|null>} getNftMetadata
 *   DAS getAsset for a single NFT mint. Returns null when the asset cannot
 *   be fetched (does not throw on 404 / not-found).
 *
 * @property {(mints: string[], environment: string) =>
 *            Promise<Map<string, {name, symbol, image}>>} getNftMetadataBatch
 *   DAS getAssets for multiple mints. Returns a Map keyed by mint.
 *
 * @property {(ownerAddress: string,
 *             options: {limit?: number, offset?: number},
 *             locals: object) =>
 *            Promise<{data: object[], pagination: object}>} getNftsByOwner
 *   DAS getAssetsByOwner combined with Token-2022 enumeration.
 *
 * @property {(mintAddress: string, locals: object) => Promise<object|null>}
 *   getNftByMint
 *   DAS getAsset for a single mint, returning the wallet-canonical NFT shape.
 */

class ProviderNotImplementedError extends Error {
  constructor(method, providerName) {
    super(`${providerName} does not implement ${method}`);
    this.name = 'ProviderNotImplementedError';
    this.method = method;
    this.provider = providerName;
  }
}

module.exports = {
  ProviderNotImplementedError,
};
