'use strict';

/**
 * Solana NFT transfer service.
 *
 * Builds unsigned transfer transactions for the supported Metaplex NFT
 * variants. Mirrors `burn-service`: each function returns a serialized
 * transaction ready for the client to sign — the service never signs.
 *
 * Why this exists at all: a plain SPL `transfer` works for a classic NFT but
 * ALWAYS fails for a programmable NFT (pNFT) with `Account is frozen`
 * (SPL Token custom error 0x11). pNFTs deliberately keep their token account
 * frozen so that every move is forced through Token Metadata's `transferV1`,
 * which thaws, moves, re-freezes, and updates the token records while
 * validating the collection's authorization rules.
 *
 * `transferV1` is the unified instruction across token standards — the same
 * builder handles NonFungible and ProgrammableNonFungible; only the extra pNFT
 * accounts (token records + auth rules) differ. See
 * https://metaplex.com/docs/token-metadata/transfer
 */

const { PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
const {
  createNoopSigner,
  signerIdentity,
  unwrapOptionRecursively,
} = require('@metaplex-foundation/umi');
const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults');
const {
  fetchDigitalAssetWithAssociatedToken,
  findTokenRecordPda,
  mplTokenMetadata,
  TokenStandard,
  transferV1,
} = require('@metaplex-foundation/mpl-token-metadata');
const {
  getAssetWithProof,
  mplBubblegum,
  transfer: transferCompressed,
} = require('@metaplex-foundation/mpl-bubblegum');
const { dasApi } = require('@metaplex-foundation/digital-asset-standard-api');
const { fromWeb3JsPublicKey } = require('@metaplex-foundation/umi-web3js-adapters');
const providers = require('./providers');
const {
  OversizedSolanaNftTransferTransactionError,
  UnsupportedSolanaNftTransferError,
} = require('./nft-transfer-errors');
const { rethrowAsOwnershipError } = require('./nft-ownership-errors');
const { createTransactionResponseFromUmiBuilder } = require('./transaction-serialization');

/** Umi wired with token-metadata, bubblegum, DAS and a no-op owner signer. */
const createTransferUmi = (nodeUrl, signer) => {
  const umi = createUmi(nodeUrl).use(mplTokenMetadata()).use(mplBubblegum()).use(dasApi());
  umi.use(signerIdentity(signer));
  return umi;
};

const createNoopOwnerSigner = (owner) => {
  return createNoopSigner(fromWeb3JsPublicKey(new PublicKey(owner)));
};

const isProgrammable = (tokenStandard) => {
  return (
    tokenStandard === TokenStandard.ProgrammableNonFungible ||
    tokenStandard === TokenStandard.ProgrammableNonFungibleEdition
  );
};

const buildSingleTransactionResponse = async (umi, builder) => {
  if (typeof builder.fitsInOneTransaction === 'function' && !builder.fitsInOneTransaction(umi)) {
    const size =
      typeof builder.getTransactionSize === 'function'
        ? builder.getTransactionSize(umi)
        : 'unknown';
    throw new OversizedSolanaNftTransferTransactionError(size);
  }

  return createTransactionResponseFromUmiBuilder(umi, builder);
};

/**
 * Build an unsigned transfer for a non-compressed NFT (classic or programmable).
 *
 * @param {string} mintAddress - Mint of the NFT being sent.
 * @param {string} owner - Current owner; also the fee payer and signer.
 * @param {string} destination - Recipient wallet address.
 * @param {Object} locals - Request locals carrying `network.config.nodeUrl`.
 * @returns {Promise<Object>} Serialized transaction for the client to sign.
 * @throws {UnsupportedSolanaNftTransferError} If the asset has no token standard.
 */
const transferNftTransaction = async (mintAddress, owner, destination, locals) => {
  const { nodeUrl } = locals.network.config;
  const ownerSigner = createNoopOwnerSigner(owner);
  const umi = createTransferUmi(nodeUrl, ownerSigner);

  const mintPublicKey = fromWeb3JsPublicKey(new PublicKey(mintAddress));
  const destinationPublicKey = fromWeb3JsPublicKey(new PublicKey(destination));

  const digitalAsset = await fetchDigitalAssetWithAssociatedToken(
    umi,
    mintPublicKey,
    ownerSigner.publicKey
  ).catch(
    rethrowAsOwnershipError(
      UnsupportedSolanaNftTransferError,
      'Only the current owner can transfer this NFT.'
    )
  );

  const tokenStandard = unwrapOptionRecursively(digitalAsset.metadata.tokenStandard);
  if (tokenStandard == null) {
    throw new UnsupportedSolanaNftTransferError('NFT metadata is missing token standard.');
  }

  const parameters = {
    mint: mintPublicKey,
    authority: ownerSigner,
    tokenOwner: ownerSigner.publicKey,
    destinationOwner: destinationPublicKey,
    tokenStandard,
  };

  // A pNFT additionally needs both token records and the collection's rule set.
  // Classic NFTs must NOT carry them.
  if (isProgrammable(tokenStandard)) {
    // Derive the recipient's ATA with spl-token so we don't pull in mpl-toolbox
    // just for findAssociatedTokenPda.
    const destinationAta = getAssociatedTokenAddressSync(
      new PublicKey(mintAddress),
      new PublicKey(destination),
      true
    );

    parameters.tokenRecord = digitalAsset.tokenRecord?.publicKey;
    parameters.destinationTokenRecord = findTokenRecordPda(umi, {
      mint: mintPublicKey,
      token: fromWeb3JsPublicKey(destinationAta),
    });
    parameters.authorizationRules =
      unwrapOptionRecursively(digitalAsset.metadata.programmableConfig)?.ruleSet ?? undefined;
  }

  const builder = transferV1(umi, parameters).setFeePayer(ownerSigner).useV0();

  return buildSingleTransactionResponse(umi, builder);
};

/**
 * Build an unsigned transfer for a compressed NFT (cNFT) via Bubblegum.
 *
 * @param {string} assetId - DAS asset id of the compressed NFT.
 * @param {string} owner - Current leaf owner; also the fee payer.
 * @param {string} destination - Recipient wallet address.
 * @param {Object} locals - Request locals carrying `network.config.nodeUrl`.
 * @returns {Promise<Object>} Serialized transaction for the client to sign.
 * @throws {UnsupportedSolanaNftTransferError} If the caller is not the leaf owner.
 */
const transferCompressedNftTransaction = async (assetId, owner, destination, locals) => {
  const { nodeUrl } = locals.network.config;
  const environment = locals.network?.environment || 'mainnet';
  const ownerSigner = createNoopOwnerSigner(owner);
  const umi = createTransferUmi(nodeUrl, ownerSigner);
  const assetPublicKey = fromWeb3JsPublicKey(new PublicKey(assetId));

  // See burn-service: the proof lookup is routed through the resolver so it
  // gets the Triton → Helius fallback; the builder keeps using `nodeUrl`.
  const assetWithProof = await providers.dispatchDasRpc(
    'getAssetWithProof',
    environment,
    (rpcUrl) =>
      getAssetWithProof(createTransferUmi(rpcUrl, ownerSigner), assetPublicKey, {
        truncateCanopy: true,
      })
  );

  if (String(assetWithProof.leafOwner) !== String(ownerSigner.publicKey)) {
    throw new UnsupportedSolanaNftTransferError(
      'Only the current owner can transfer this compressed NFT.'
    );
  }

  const builder = transferCompressed(umi, {
    ...assetWithProof,
    leafOwner: ownerSigner,
    newLeafOwner: fromWeb3JsPublicKey(new PublicKey(destination)),
  })
    .setFeePayer(ownerSigner)
    .useV0();

  return buildSingleTransactionResponse(umi, builder);
};

module.exports = {
  transferNftTransaction,
  transferCompressedNftTransaction,
};
