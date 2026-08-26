/**
 * Solana NFT burn service.
 *
 * Builds unsigned burn transactions for the supported Metaplex NFT
 * variants: master editions, print editions, programmable NFTs (pNFT),
 * and compressed NFTs (cNFT). For oversized cNFT burns it falls back to
 * a temporary address lookup table flow via `address-lookup-table-service`.
 *
 * Each public function returns a serialized transaction (or list of
 * transactions) ready for the client to sign — the service never signs.
 */

const { Connection, PublicKey, TransactionInstruction, Transaction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, createCloseAccountInstruction } = require('@solana/spl-token');
const { createNoopSigner, none, signerIdentity, some } = require('@metaplex-foundation/umi');
const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults');
const {
  burnV1,
  fetchDigitalAssetWithAssociatedToken,
  findMetadataPda,
  mplTokenMetadata,
  TokenStandard,
} = require('@metaplex-foundation/mpl-token-metadata');
const {
  burn: burnCompressedLegacy,
  burnV2,
  getAssetWithProof,
  mplBubblegum,
} = require('@metaplex-foundation/mpl-bubblegum');
const { dasApi } = require('@metaplex-foundation/digital-asset-standard-api');
const {
  fromWeb3JsPublicKey,
  toWeb3JsTransaction,
} = require('@metaplex-foundation/umi-web3js-adapters');
const BufferLayout = require('buffer-layout');
const { BN } = require('bn.js');
const lookupTableService = require('./address-lookup-table-service');
const providers = require('./providers');
const {
  OversizedSolanaNftBurnTransactionError,
  UnsupportedSolanaNftBurnError,
} = require('./solana-nft-burn-errors');
const { rethrowAsOwnershipError } = require('./nft-ownership-errors');
const {
  createTransactionResponseFromWeb3,
  createTransactionResponseFromUmiBuilder,
} = require('./transaction-serialization');

/** Create a Umi instance wired with token-metadata, bubblegum, DAS, and an optional signer. */
const createBurnUmi = (nodeUrl, signer) => {
  const umi = createUmi(nodeUrl).use(mplTokenMetadata()).use(mplBubblegum()).use(dasApi());

  if (signer) {
    umi.use(signerIdentity(signer));
  }

  return umi;
};

/**
 * Wrap `owner` as a Umi `NoopSigner` — a signer identity that satisfies
 * builder requirements without holding a private key, since burn
 * transactions are returned unsigned for the client to sign.
 */
const createNoopOwnerSigner = (owner) => {
  return createNoopSigner(fromWeb3JsPublicKey(new PublicKey(owner)));
};

/** Unwrap a Umi `Option<T>` (`{__option: 'Some'|'None', value}`) to `T|null`. */
const unwrapOption = (value) => {
  if (!value || typeof value !== 'object' || value.__option !== 'Some') {
    return null;
  }

  return value.value;
};

/**
 * Resolve the metadata PDA of a digital asset's parent collection, if any.
 * @returns {PublicKey|undefined} Collection metadata PDA, or undefined when
 *   the asset has no collection set.
 */
const getCollectionMetadata = (umi, digitalAsset) => {
  const collection = unwrapOption(digitalAsset.metadata.collection);
  if (!collection) {
    return undefined;
  }

  return findMetadataPda(umi, {
    mint: collection.key,
  });
};

/**
 * Guard a Umi builder against exceeding Solana's single-transaction size
 * limit before it is serialized.
 * @throws {OversizedSolanaNftBurnTransactionError} If the builder does not
 *   fit in one transaction.
 */
const ensureBuilderFitsInOneTransaction = (umi, builder) => {
  if (typeof builder.fitsInOneTransaction === 'function' && !builder.fitsInOneTransaction(umi)) {
    const size =
      typeof builder.getTransactionSize === 'function'
        ? builder.getTransactionSize(umi)
        : 'unknown';
    throw new OversizedSolanaNftBurnTransactionError(size);
  }
};

/** Build + serialize a Umi builder as a single tx, after a size guard. */
const buildSingleTransactionResponse = async (umi, builder) => {
  ensureBuilderFitsInOneTransaction(umi, builder);
  return createTransactionResponseFromUmiBuilder(umi, builder);
};

/**
 * Build + serialize a cNFT burn builder. When it fits in one transaction,
 * serializes directly; otherwise builds the oversized tx, extracts its
 * static account keys, and delegates to `address-lookup-table-service` to
 * produce the create/extend lookup-table transactions plus a final burn tx
 * rebuilt against that lookup table.
 * @returns {Promise<Object>} Single-tx response, or
 *   `{transactions, lookupTable, message}` for the lookup-table fallback.
 * @throws {OversizedSolanaNftBurnTransactionError} If the burn still does
 *   not fit even after lookup-table compression, or if there were no
 *   candidate addresses to compress in the first place.
 */
const buildCompressedBurnTransactionResponse = async (umi, builder, owner, nodeUrl) => {
  if (typeof builder.fitsInOneTransaction !== 'function' || builder.fitsInOneTransaction(umi)) {
    return createTransactionResponseFromUmiBuilder(umi, builder);
  }

  const builtTransaction = await builder.buildWithLatestBlockhash(umi);
  const web3Transaction = toWeb3JsTransaction(builtTransaction);
  const lookupTableFallback = await lookupTableService.createLookupTableFallbackTransactions({
    owner,
    nodeUrl,
    versionedTransaction: web3Transaction,
  });

  if (!lookupTableFallback) {
    throw new OversizedSolanaNftBurnTransactionError(builder.getTransactionSize(umi));
  }

  const lookupBuilder = builder.setAddressLookupTables([lookupTableFallback.lookupTableInput]);

  ensureBuilderFitsInOneTransaction(umi, lookupBuilder);

  const burnTransaction = await createTransactionResponseFromUmiBuilder(umi, lookupBuilder);

  return {
    transactions: [
      ...lookupTableFallback.transactions,
      {
        ...burnTransaction,
        step: 'burn',
      },
    ],
    lookupTable: lookupTableFallback.lookupTable,
    message: 'Compressed NFT burn requires a temporary lookup table flow.',
  };
};

/** True when the DAS proof response uses the newer leaf-schema v2 fields. */
const usesCompressedLeafSchemaV2 = (assetWithProof) => {
  return assetWithProof.asset_data_hash !== undefined || assetWithProof.flags !== undefined;
};

/** Set the fee payer and force v0 message compilation on a burn builder. */
const prepareVersionedBurnBuilder = (builder, ownerSigner) => {
  return builder.setFeePayer(ownerSigner).useV0();
};

/**
 * Build the correct cNFT burn instruction for the asset's leaf schema:
 * `burnV2` for leaf-schema v2 (asset_data_hash / flags present), legacy
 * `burn` otherwise.
 */
const createCompressedBurnBuilder = (umi, ownerSigner, assetWithProof) => {
  if (usesCompressedLeafSchemaV2(assetWithProof)) {
    return burnV2(umi, {
      payer: ownerSigner,
      authority: ownerSigner,
      leafOwner: assetWithProof.leafOwner,
      merkleTree: assetWithProof.merkleTree,
      root: assetWithProof.root,
      dataHash: assetWithProof.dataHash,
      creatorHash: assetWithProof.creatorHash,
      assetDataHash: assetWithProof.asset_data_hash ? some(assetWithProof.asset_data_hash) : none(),
      flags: assetWithProof.flags == null ? none() : some(assetWithProof.flags),
      nonce: assetWithProof.nonce,
      index: assetWithProof.index,
      proof: assetWithProof.proof,
    });
  }

  return burnCompressedLegacy(umi, {
    leafOwner: ownerSigner.publicKey,
    leafDelegate: assetWithProof.leafDelegate,
    merkleTree: assetWithProof.merkleTree,
    root: assetWithProof.root,
    dataHash: assetWithProof.dataHash,
    creatorHash: assetWithProof.creatorHash,
    nonce: assetWithProof.nonce,
    index: assetWithProof.index,
    proof: assetWithProof.proof,
  });
};

/**
 * Build an unsigned burn transaction for a Metaplex master-edition NFT.
 *
 * Uses Metaplex Umi's `burnV1` with the `NonFungible` token standard, which
 * emits the same Token Metadata `Burn` instruction the deprecated
 * `@metaplex-foundation/js` deleter used to emit. When the NFT belongs to a
 * collection the collection's metadata PDA is passed too: the Burn handler
 * requires it whenever the collection is verified (and additionally uses it to
 * decrement a sized collection's supply), so omitting it makes the burn fail
 * on chain for any NFT in a verified collection.
 *
 * @param {string} mintAddress - Mint address of the NFT to burn.
 * @param {string} owner - Wallet that owns the NFT (becomes fee payer).
 * @param {Object} locals - Request locals containing `network.config.nodeUrl`.
 * @returns {Promise<Object>} Serialized transaction response ready for the
 *   client to sign.
 * @throws {Error} If `mintAddress` or `owner` is not a valid base58 public key
 *   (PublicKey constructor throws), or if the RPC calls that load the asset and
 *   the latest blockhash fail.
 * @throws {OversizedSolanaNftBurnTransactionError} If the resulting transaction
 *   does not fit in a single Solana transaction.
 */
const burnMasterEditionTransaction = async (mintAddress, owner, locals) => {
  const { nodeUrl } = locals.network.config;
  const ownerSigner = createNoopOwnerSigner(owner);
  const umi = createBurnUmi(nodeUrl, ownerSigner);
  const mintPublicKey = fromWeb3JsPublicKey(new PublicKey(mintAddress));

  const digitalAsset = await fetchDigitalAssetWithAssociatedToken(
    umi,
    mintPublicKey,
    ownerSigner.publicKey
  ).catch(
    rethrowAsOwnershipError(
      UnsupportedSolanaNftBurnError,
      'Only the current owner can burn this NFT.'
    )
  );

  const builder = prepareVersionedBurnBuilder(
    burnV1(umi, {
      authority: ownerSigner,
      mint: mintPublicKey,
      token: digitalAsset.token.publicKey,
      tokenOwner: ownerSigner.publicKey,
      tokenStandard: TokenStandard.NonFungible,
      metadata: digitalAsset.metadata.publicKey,
      edition: digitalAsset.edition?.publicKey,
      collectionMetadata: getCollectionMetadata(umi, digitalAsset),
    }),
    ownerSigner
  );

  return buildSingleTransactionResponse(umi, builder);
};

/** `buffer-layout` field for an 8-byte (u64) little-endian value. */
const uint64 = (property = 'uint64') => {
  return BufferLayout.blob(8, property);
};

// Encode `value` as a little-endian 8-byte (u64) buffer using BN. The
// `buffer-layout` `blob(8)` field this fills accepts any 8-byte buffer; BN's
// `toArrayLike(Buffer, 'le', 8)` produces exactly that, so we don't need a
// custom u64 class.
const u64ToLeBuffer = (value) => new BN(value).toArrayLike(Buffer, 'le', 8);

/**
 * Build an unsigned burn transaction for a Metaplex print-edition NFT.
 *
 * Issues the SPL token Burn instruction (instruction code 8) with amount 1
 * and follows it with a `closeAccount` so the rent lamports return to the
 * owner.
 *
 * @param {string} mintAddress - Mint address of the edition NFT.
 * @param {PublicKey} mintAccount - Token account holding the edition.
 * @param {string} owner - Wallet that owns the NFT (becomes fee payer).
 * @param {Object} locals - Request locals containing `network.config.nodeUrl`.
 * @returns {Promise<Object>} Serialized transaction response ready for the
 *   client to sign.
 */
const burnEditionsTransaction = async (mintAddress, mintAccount, owner, locals) => {
  const { nodeUrl } = locals.network.config;
  const connection = new Connection(nodeUrl, 'confirmed');
  const nftAmount = 1;
  const dataLayout = BufferLayout.struct([BufferLayout.u8('instruction'), uint64('amount')]);
  const data = Buffer.alloc(dataLayout.span);
  const pkOwner = new PublicKey(owner);

  dataLayout.encode(
    {
      instruction: 8,
      amount: u64ToLeBuffer(nftAmount),
    },
    data
  );

  const keys = [
    {
      pubkey: mintAccount,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: new PublicKey(mintAddress),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: pkOwner,
      isSigner: true,
      isWritable: false,
    },
  ];

  const deleteNft = new TransactionInstruction({
    keys,
    programId: TOKEN_PROGRAM_ID,
    data,
  });

  const destination = pkOwner;
  const authority = pkOwner;

  const closeAccount = createCloseAccountInstruction(
    mintAccount,
    destination,
    authority,
    [],
    TOKEN_PROGRAM_ID
  );

  const transaction = new Transaction().add(deleteNft).add(closeAccount);

  transaction.feePayer = pkOwner;
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return createTransactionResponseFromWeb3(transaction);
};

/**
 * Build an unsigned burn transaction for a programmable NFT (pNFT).
 *
 * Uses Metaplex Umi's `burnV1` builder. Programmable editions and
 * non-original editions are rejected with `UnsupportedSolanaNftBurnError`
 * because the underlying program does not allow burning them through this
 * path.
 *
 * @param {string} mintAddress - Mint address of the pNFT to burn.
 * @param {string} owner - Wallet that owns the pNFT (becomes fee payer).
 * @param {Object} locals - Request locals containing `network.config.nodeUrl`.
 * @returns {Promise<Object>} Serialized transaction response ready for the
 *   client to sign.
 * @throws {UnsupportedSolanaNftBurnError} If the asset is a pNFT edition or
 *   missing a token standard.
 * @throws {OversizedSolanaNftBurnTransactionError} If the resulting
 *   transaction does not fit in a single Solana transaction.
 */
const burnProgrammableNftTransaction = async (mintAddress, owner, locals) => {
  const { nodeUrl } = locals.network.config;
  const ownerSigner = createNoopOwnerSigner(owner);
  const umi = createBurnUmi(nodeUrl, ownerSigner);
  const mintPublicKey = fromWeb3JsPublicKey(new PublicKey(mintAddress));

  const digitalAsset = await fetchDigitalAssetWithAssociatedToken(
    umi,
    mintPublicKey,
    ownerSigner.publicKey
  ).catch(
    rethrowAsOwnershipError(
      UnsupportedSolanaNftBurnError,
      'Only the current owner can burn this NFT.'
    )
  );

  const tokenStandard = unwrapOption(digitalAsset.metadata.tokenStandard);
  if (tokenStandard == null) {
    throw new UnsupportedSolanaNftBurnError('Programmable NFT metadata is missing token standard.');
  }

  if (
    tokenStandard === TokenStandard.ProgrammableNonFungibleEdition ||
    digitalAsset.edition?.isOriginal === false
  ) {
    throw new UnsupportedSolanaNftBurnError(
      'Programmable NFT editions are not currently supported for burn.'
    );
  }

  const builder = prepareVersionedBurnBuilder(
    burnV1(umi, {
      authority: ownerSigner,
      mint: mintPublicKey,
      token: digitalAsset.token.publicKey,
      tokenOwner: ownerSigner.publicKey,
      tokenStandard,
      metadata: digitalAsset.metadata.publicKey,
      edition: digitalAsset.edition?.publicKey,
      tokenRecord: digitalAsset.tokenRecord?.publicKey,
      collectionMetadata: getCollectionMetadata(umi, digitalAsset),
    }),
    ownerSigner
  );

  return buildSingleTransactionResponse(umi, builder);
};

/**
 * Build an unsigned burn transaction for a compressed NFT (cNFT).
 *
 * Resolves the asset's Merkle proof via DAS, picks the correct burn
 * instruction (`burnV2` for leaf-schema v2, legacy `burn` otherwise), and
 * versions the transaction. If the resulting tx exceeds the size limit,
 * falls back to a temporary address lookup table flow that returns multiple
 * transactions plus rent estimates.
 *
 * @param {string} assetId - DAS asset id of the compressed NFT.
 * @param {string} owner - Current leaf owner / fee payer.
 * @param {Object} locals - Request locals containing `network.config.nodeUrl` and
 *   `network.environment`.
 * @returns {Promise<Object>} Serialized transaction response (single tx) or
 *   an object with `{transactions, lookupTable, message}` for the
 *   lookup-table fallback flow.
 * @throws {UnsupportedSolanaNftBurnError} If the caller is not the current
 *   leaf owner.
 * @throws {OversizedSolanaNftBurnTransactionError} If even the lookup-table
 *   fallback cannot fit the burn into one transaction.
 */
const burnCompressedNftTransaction = async (assetId, owner, locals) => {
  const { nodeUrl } = locals.network.config;
  const environment = locals.network?.environment || 'mainnet';
  const ownerSigner = createNoopOwnerSigner(owner);
  const umi = createBurnUmi(nodeUrl, ownerSigner);
  const assetPublicKey = fromWeb3JsPublicKey(new PublicKey(assetId));
  // The proof lookup goes through the resolver so it gets the Triton → Helius
  // fallback, rate budget and logging the rest of the DAS surface has. The
  // builder keeps using `nodeUrl`, which only supplies the blockhash.
  const assetWithProof = await providers.dispatchDasRpc(
    'getAssetWithProof',
    environment,
    (rpcUrl) =>
      getAssetWithProof(createBurnUmi(rpcUrl, ownerSigner), assetPublicKey, {
        truncateCanopy: true,
      })
  );

  if (String(assetWithProof.leafOwner) !== String(ownerSigner.publicKey)) {
    throw new UnsupportedSolanaNftBurnError('Only the current owner can burn this compressed NFT.');
  }

  const builder = prepareVersionedBurnBuilder(
    createCompressedBurnBuilder(umi, ownerSigner, assetWithProof),
    ownerSigner
  );

  return buildCompressedBurnTransactionResponse(umi, builder, owner, nodeUrl);
};

module.exports = {
  burnMasterEditionTransaction,
  burnEditionsTransaction,
  burnProgrammableNftTransaction,
  burnCompressedNftTransaction,
};
