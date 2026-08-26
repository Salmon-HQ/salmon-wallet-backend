'use strict';

const { includeBlacklisted } = require('../shared/resource-includes');
const { SOLANA } = require('../../constants/blockchains');
const { normalizeIpfsUrl } = require('./content-urls');
const imageOverrides = require('../../services/solana/nft-image-override-service');
const spamDetector = require('../../services/solana/nft-spam-detector');

/**
 * Token Standard values from Metaplex
 * See: https://developers.metaplex.com/token-metadata/token-standard
 */
const TokenStandard = {
  NonFungible: 0, // NFT with Master Edition
  FungibleAsset: 1, // Semi-fungible (has attributes)
  Fungible: 2, // Simple fungible token
  NonFungibleEdition: 3, // Printed edition from Master
  ProgrammableNonFungible: 4, // pNFT (frozen, with rules)
  ProgrammableNonFungibleEdition: 5, // pNFT edition
};

/**
 * Extracts the token standard value from Umi's Option type
 * Umi uses {__option: "Some", value: X} or {__option: "None"} pattern
 * @param {object|number|null} tokenStandard - The token standard (Umi Option or raw value)
 * @returns {number|null} - The numeric token standard value or null
 */
const extractTokenStandard = (tokenStandard) => {
  if (tokenStandard === null || tokenStandard === undefined) {
    return null;
  }
  // Handle Umi Option type: {__option: "Some", value: X}
  if (typeof tokenStandard === 'object' && tokenStandard.__option !== undefined) {
    return tokenStandard.__option === 'Some' ? tokenStandard.value : null;
  }
  // Handle raw number value
  return typeof tokenStandard === 'number' ? tokenStandard : null;
};

/**
 * Checks if a token is a non-fungible (NFT) based on tokenStandard
 * @param {object|number|null} tokenStandard - The token standard (Umi Option or raw value)
 * @param {object} nft - The NFT object (for fallback checks)
 * @returns {boolean} - True if the token is an NFT
 */
const isNonFungible = (tokenStandard, nft) => {
  const standardValue = extractTokenStandard(tokenStandard);

  // If tokenStandard is defined, use it
  if (standardValue !== null) {
    return [
      TokenStandard.NonFungible,
      TokenStandard.NonFungibleEdition,
      TokenStandard.ProgrammableNonFungible,
      TokenStandard.ProgrammableNonFungibleEdition,
    ].includes(standardValue);
  }

  // Fallback for legacy NFTs: check if has edition (Master or Print Edition)
  if (nft.edition !== undefined) {
    return true;
  }

  // For Token2022 NFTs: must have extensions AND tokenAmount with decimals=0
  // The repository already filters to only include decimals=0 and uiAmount=1
  if (nft.extensions !== undefined && nft.tokenAmount?.decimals === 0) {
    return true;
  }

  return false;
};

/**
 * Solana NFT resource — public response shape for `/nft` + `/nft/:mint`.
 * Returns `null` for fungible tokens (only NFTs pass through). Resolves the
 * display image via `imageOverrides` → `json.image` → `nft.image` (each run
 * through `normalizeIpfsUrl`), scores spam via `spamDetector`, and side-loads
 * `blacklisted` via `includeBlacklisted`.
 *
 * @param {Object} nft - Raw parsed NFT record (owner, mint, symbol, uri,
 *   name, json metadata, extensions, tokenStandard).
 * @param {Object} include - relation include map, forwarded to `includeBlacklisted`
 * @param {string} key - decorator chain key, forwarded to `includeBlacklisted`
 * @param {Object} context - per-request context, forwarded to `includeBlacklisted`;
 *   `context.locals.nftNameCounts` (set by the listing service) feeds the
 *   detector's wallet-level `duplicate_name` reason
 * @returns {Promise<Object|null>} resource, or `null` when `nft` is fungible
 * @returns {string} resource.mint
 * @returns {string} resource.owner
 * @returns {string} resource.name
 * @returns {string} resource.symbol
 * @returns {string} resource.uri - normalized metadata URI
 * @returns {string} [resource.description]
 * @returns {Object} [resource.collection]
 * @returns {string|null} resource.media - normalized display image URL
 * @returns {Object} resource.extras - `{ creators, attributes, properties }`;
 *   `creators` is `[{ address, share, verified }]`, preferring the on-chain
 *   list DAS reports (`nft.creators`) over the off-chain `json.creators`, which
 *   carries no `verified` flag and is whatever the minter chose to write.
 * @returns {Object} [resource.extensions]
 * @returns {number} resource.spamScore
 * @returns {Array} resource.spamReasons
 * @returns {boolean} [resource.blacklisted] - set by `includeBlacklisted`
 */
module.exports = async (nft, include, key, context) => {
  const { owner, mint, symbol, uri, name, json, extensions, tokenStandard } = nft;

  // Filter out fungible tokens - only return NFTs
  if (!isNonFungible(tokenStandard, nft)) {
    return null;
  }

  const overrideUrl = imageOverrides.lookup(mint.address);
  const media =
    normalizeIpfsUrl(overrideUrl) ||
    normalizeIpfsUrl(json?.image) ||
    normalizeIpfsUrl(nft.image) ||
    null;

  const { spamScore, spamReasons } = spamDetector.score(
    {
      name,
      description: json?.description,
      image: json?.image || nft.image,
      collectionName: json?.collection?.name,
      // DAS puts the collection in `grouping`, which the provider maps to a
      // top-level `collection` — it is never inside `json`. Reading only
      // `json.collection.name` meant every DAS-sourced NFT looked collectionless.
      // Only a verified grouping counts: anyone can point a mint at a collection
      // they made up, so an unverified one is no legitimacy signal.
      hasCollection: nft.collection?.verified === true,
      attributes: json?.attributes,
      metadataResolved: nft.metadataResolved !== false,
    },
    // Set by `solana-nft-service.list` for the page this item came from.
    { nameCounts: context?.locals?.nftNameCounts }
  );

  const resource = {
    mint: mint.address,
    owner,
    name,
    symbol,
    uri: normalizeIpfsUrl(uri),
    description: json?.description,
    collection: json?.collection,
    media,
    extras: {
      creators: nft.creators?.length ? nft.creators : json?.creators,
      attributes: json?.attributes,
      properties: json?.properties,
    },
    extensions,
    spamScore,
    spamReasons,
  };

  await includeBlacklisted(SOLANA, resource, include, key, context);

  return resource;
};
