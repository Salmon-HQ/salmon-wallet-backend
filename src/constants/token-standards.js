'use strict';

/**
 * The Metaplex token standards that name one indivisible asset. Programmable
 * NFTs (`ProgrammableNonFungible`, the standard most collections migrated
 * to) are NFTs like the plain ones: a transfer of one is an NFT leg, and
 * its metadata is fetched from DAS with the rest.
 */
const NFT_TOKEN_STANDARDS = new Set([
  'NonFungible',
  'NonFungibleEdition',
  'ProgrammableNonFungible',
  'ProgrammableNonFungibleEdition',
]);

const isNftTokenStandard = (tokenStandard) => NFT_TOKEN_STANDARDS.has(tokenStandard);

module.exports = { NFT_TOKEN_STANDARDS, isNftTokenStandard };
