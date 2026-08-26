'use strict';

/**
 * Metaplex Token Metadata parser. Sets `_hints.hasNftMint` whenever a
 * `CreateMetadataAccount*` or `Mint` instruction is seen so the orchestrator
 * tags the tx as `NFT_MINT` (Helius convention).
 *
 * Token Metadata does not emit token transfers itself — the actual mint
 * happens in a CPI to the SPL Token program, which the spl-token parser
 * already handles. The Metaplex parser only contributes the type hint and
 * the source name.
 *
 * Instruction type strings come from the Metaplex IDL. The parsed RPC
 * encoder reports them in this casing:
 *   - createMetadataAccount, createMetadataAccountV2, createMetadataAccountV3
 *   - createMasterEdition, createMasterEditionV3
 *   - mint
 *   - updateMetadataAccount, updateMetadataAccountV2
 *   - signMetadata
 *   - burn, burnNft
 */

const METAPLEX_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

const NFT_MINT_TYPES = new Set([
  'createMetadataAccount',
  'createMetadataAccountV2',
  'createMetadataAccountV3',
  'createMasterEdition',
  'createMasterEditionV3',
  'mint',
  'mintNewEditionFromMasterEditionViaToken',
  'mintNewEditionFromMasterEditionViaVaultProxy',
]);

const NFT_BURN_TYPES = new Set(['burn', 'burnNft', 'burnEditionNft']);

/**
 * Match Metaplex Token Metadata instructions and set `hasNftMint` /
 * `hasNftBurn` hints. When the RPC can't decode the instruction (`parsed`
 * missing), falls back to a weaker `hasMetaplex` hint that only confirms
 * program involvement.
 * @param {object} parsedIx - Parsed RPC instruction for Token Metadata
 * @param {object} ctx      - Orchestrator context (`{ building, ... }`)
 * @returns {void}
 */
const parse = (parsedIx, ctx) => {
  const parsed = parsedIx?.parsed;
  if (!parsed?.type) {
    // Even unparsed Metaplex instructions are useful: just being present
    // suggests NFT activity. We don't mark as mint here — that requires
    // the SPL Token CPI underneath. We only confirm Metaplex involvement.
    ctx.building._hints.hasMetaplex = true;
    return;
  }

  if (NFT_MINT_TYPES.has(parsed.type)) {
    ctx.building._hints.hasNftMint = true;
    return;
  }

  if (NFT_BURN_TYPES.has(parsed.type)) {
    ctx.building._hints.hasNftBurn = true;
  }
};

module.exports = {
  programIds: [METAPLEX_PROGRAM_ID],
  parse,
};
