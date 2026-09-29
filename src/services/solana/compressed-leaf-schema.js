'use strict';

/**
 * True when the DAS proof response uses the newer leaf-schema v2 fields.
 *
 * Bubblegum refuses a V1 instruction on a V2 leaf (`UnsupportedSchemaVersion`),
 * so every compressed-NFT builder picks its instruction version from this.
 */
const usesCompressedLeafSchemaV2 = (assetWithProof) => {
  return assetWithProof.asset_data_hash !== undefined || assetWithProof.flags !== undefined;
};

module.exports = { usesCompressedLeafSchemaV2 };
