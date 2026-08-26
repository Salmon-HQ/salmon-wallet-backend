'use strict';

/**
 * Shared DAS-asset normalization and NFT pagination helpers used by both
 * the Triton and Helius providers. The DAS spec is identical across both
 * (Helius authored the spec, Triton implements the same JSON-RPC methods),
 * so these helpers are provider-agnostic.
 */

const { PublicKey } = require('@solana/web3.js');
const { TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Canonical normalization for a DAS asset response into the FE NFT shape.
 * Used by both Triton and Helius DAS providers so the resolver returns a
 * single shape regardless of which provider served the call.
 *
 * `collection.verified` reads the grouping's `verified` flag. Both providers
 * (probed 2026-08-25 against Triton and Helius) omit unverified collections
 * from `grouping` by default and only emit the flag when the call passes
 * `options.showUnverifiedCollections: true`, so an absent flag means the
 * provider already filtered to verified collections — it maps to `true`, and
 * only an explicit `verified: false` yields `false`.
 *
 * @param {Object} asset - Raw DAS asset (from getAsset / getAssetsByOwner).
 * @param {string} owner - Owner wallet to embed.
 * @returns {{
 *   mint: {address: string},
 *   owner: string,
 *   name: string,
 *   symbol: string,
 *   uri: string,
 *   json: Object,
 *   updateAuthorityAddress: string|null,
 *   sellerFeeBasisPoints: number,
 *   creators: Array,
 *   collection: {key: string, verified: boolean}|null,
 *   edition: {isOriginal: boolean}|null,
 *   tokenStandard: string|null,
 *   decimals: number|null,
 *   image: string|null,
 *   compressed: boolean,
 * }}
 */
const transformDasAsset = (asset, owner) => {
  const metadata = asset.content?.metadata || {};
  const links = asset.content?.links || {};
  const files = asset.content?.files || [];
  const collection = asset.grouping?.find((g) => g.group_key === 'collection');

  return {
    mint: { address: asset.id },
    owner,
    name: metadata.name || '',
    symbol: metadata.symbol || '',
    uri: asset.content?.json_uri || '',
    json: metadata,
    updateAuthorityAddress:
      asset.authorities?.find((a) => a.scopes?.includes('full'))?.address || null,
    sellerFeeBasisPoints: asset.royalty?.basis_points || 0,
    creators: asset.creators || [],
    collection: collection
      ? { key: collection.group_value, verified: collection.verified !== false }
      : null,
    edition:
      asset.supply?.edition_nonce != null ? { isOriginal: asset.supply.edition_nonce === 0 } : null,
    tokenStandard: asset.interface || null,
    // Mint decimals from the DAS `token_info` block. The burn/transfer guard in
    // `solana-nft-service` relies on this to tell an NFT (0) from a fungible
    // mint (USDC: 6); `interface` alone is not enough because the indexer
    // reports plenty of fungible mints as `Custom`. Null when not indexed.
    decimals: asset.token_info?.decimals ?? null,
    image: links.image || files[0]?.uri || null,
    compressed: asset.compression?.compressed || false,
  };
};

/**
 * Discover Token-2022 NFTs (decimals=0, uiAmount=1) owned by a wallet via
 * `getParsedTokenAccountsByOwner`. Note the asymmetry: the returned shape
 * differs from `transformDasAsset`'s output — these come from the SPL Token
 * program, not DAS, so they only carry mint + extensions + tokenAmount.
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string} publicKeyStr - Owner wallet.
 * @returns {Promise<Array<{mint:{address:string}, extensions:Object, tokenAmount:{decimals:number,amount:string,uiAmount:number}}>>}
 */
const fetchToken2022NftsByOwner = async (connection, publicKeyStr) => {
  const owner = new PublicKey(publicKeyStr);
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_2022_PROGRAM_ID,
  });

  return (tokenAccounts.value || [])
    .map((account) => account.account.data.parsed.info)
    .filter(({ tokenAmount }) => tokenAmount.decimals === 0 && tokenAmount.uiAmount === 1)
    .map(({ mint, extensions, tokenAmount }) => ({
      mint: { address: mint },
      extensions,
      tokenAmount: {
        decimals: tokenAmount.decimals,
        amount: tokenAmount.amount,
        uiAmount: tokenAmount.uiAmount,
      },
    }));
};

/**
 * Slice a pre-loaded NFT list into a `{data, pagination}` page.
 * @param {Array} nfts
 * @param {number} limit
 * @param {number} offset
 * @returns {{data: Array, pagination: {total: number, limit: number, offset: number, hasMore: boolean, nextOffset: number|null}}}
 */
const paginateNfts = (nfts, limit, offset) => {
  const total = nfts.length;
  const data = nfts.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  return {
    data,
    pagination: {
      total,
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    },
  };
};

/**
 * Coerce raw query options into safe pagination values.
 * Defaults: `limit=DEFAULT_LIMIT (50)`, clamped to `[1, MAX_LIMIT (100)]`;
 * `offset` clamped to `>= 0`.
 *
 * FALSY-ZERO QUIRK: because the implementation uses `parseInt(...) || DEFAULT`,
 * a literal `limit=0` (or `offset=0` parsed back through the same idiom) falls
 * through to the default rather than to `0`. For `limit` the lower clamp would
 * reset `0` to `1` anyway, so the observable behavior is "0 → 50". For `offset`
 * the `|| 0` collapses to `0`, so `offset=0` is fine. Documenting here so
 * callers don't expect `limit=0` to mean "empty page".
 *
 * @param {{limit?: string|number, offset?: string|number}} [options]
 * @returns {{limit: number, offset: number}}
 */
const getPagination = (options = {}) => ({
  limit: Math.min(Math.max(1, parseInt(options.limit, 10) || DEFAULT_LIMIT), MAX_LIMIT),
  offset: Math.max(0, parseInt(options.offset, 10) || 0),
});

module.exports = {
  transformDasAsset,
  fetchToken2022NftsByOwner,
  paginateNfts,
  getPagination,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
