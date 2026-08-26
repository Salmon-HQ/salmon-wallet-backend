'use strict';

/**
 * Solana NFT service.
 *
 * Read paths (`list`, `find`) flow through the NFT repository, which in turn
 * dispatches DAS calls to the active provider resolver (Triton primary,
 * Helius fallback), and are then passed through `nft-metadata-hydrator` to
 * merge in the off-chain JSON that Triton's DAS index does not carry. The burn
 * and transfer paths deliberately skip hydration — they only need the on-chain
 * token standard, so there is no reason to pay for the fetches.
 *
 * Burn dispatch routes by token standard to the appropriate `burn-service`
 * builder.
 */

const repository = require('../../repositories/solana/solana-nft-repository');
const metadataHydrator = require('./nft-metadata-hydrator');
const spamDetector = require('./nft-spam-detector');
const burnService = require('./burn-service');
const transferService = require('./nft-transfer-service');
const addressService = require('./solana-address-service');
const {
  SolanaNftNotFoundError,
  UnsupportedSolanaNftBurnError,
} = require('./solana-nft-burn-errors');
const { UnsupportedSolanaNftTransferError } = require('./nft-transfer-errors');

const normalizeTokenStandard = (tokenStandard) => String(tokenStandard || '').toLowerCase();

/** True for Metaplex pNFT / programmable token standards. */
const isProgrammableToken = (tokenStandard) => {
  const normalized = normalizeTokenStandard(tokenStandard);
  return normalized.includes('programmable') || normalized.includes('pnft');
};

// DAS `interface` values that are fungible by definition. `Custom` is NOT in
// this list: it is a catch-all the indexer uses for both fungible mints (USDC)
// and odd non-fungible ones, so fungibility is decided by decimals instead.
const FUNGIBLE_TOKEN_STANDARDS = ['fungibletoken', 'fungibleasset', 'fungible'];

// Assets owned by programs Token Metadata's `transferV1` does not speak.
// Metaplex Core assets live in their own program, so `transferV1` fails with
// "Metadata account not found" — a 500 for an asset the listing happily shows,
// reachable from the wallet's ordinary send flow. The burn route already
// rejects these explicitly; this mirrors it.
const NON_TRANSFERABLE_TOKEN_STANDARDS = ['mplcoreasset'];

/**
 * True when the asset is a fungible mint and therefore must never reach an
 * NFT burn or transfer builder.
 *
 * `decimals` is the reliable signal: an NFT mint has 0 decimals, USDC has 6.
 * It comes from the DAS `token_info` block. When the indexer does not report
 * it (`null`/`undefined`) we fall back to the interface name only — an unknown
 * decimals must not block a legitimate NFT burn.
 *
 * Why this guard exists: `edition.isOriginal` is derived from
 * `supply.edition_nonce === 0`, and a nonce is present on plenty of mints that
 * are not print editions. USDC reports `edition_nonce: 252`, so it was routed
 * to the print-edition burn, which builds a raw SPL Burn + closeAccount — the
 * endpoint returned a ready-to-sign transaction that destroys the caller's
 * token balance.
 *
 * @param {Object} nft - Provider-normalized asset.
 * @returns {boolean}
 */
const isFungibleToken = (nft) => {
  if (FUNGIBLE_TOKEN_STANDARDS.includes(normalizeTokenStandard(nft?.tokenStandard))) {
    return true;
  }

  return typeof nft?.decimals === 'number' && nft.decimals > 0;
};

/** True for printed editions (non-original of a master edition). */
const isEditionToken = (nft) => {
  if (nft?.edition?.isOriginal === false) {
    return true;
  }

  const normalized = normalizeTokenStandard(nft?.tokenStandard);
  return normalized.includes('edition');
};

/** True for legacy / v1 NFTs and master editions (originals). */
const isMasterEditionToken = (nft) => {
  if (nft?.edition?.isOriginal === true) {
    return true;
  }

  const normalized = normalizeTokenStandard(nft?.tokenStandard);
  return ['legacy_nft', 'v1_nft', 'nft', 'nonfungible', 'non_fungible'].includes(normalized);
};

/**
 * List NFTs owned by `publicKey` via the NFT repository (DAS-driven).
 * @param {Object} args
 * @param {string} args.publicKey - Owner wallet.
 * @param {string} [args.noCache] - When `'false'`, allow cached results.
 * @param {number} [args.limit]
 * @param {number} [args.offset]
 * @param {Object} locals - Receives `nftNameCounts` (see `spamDetector.countNames`).
 * @returns {Promise<{data: Array<Object>, meta: Object}>}
 */
const list = async ({ publicKey, noCache, limit, offset }, locals) => {
  const page = await repository.findByOwner(
    publicKey,
    { cache: noCache == 'false', limit, offset },
    locals
  );
  if (!page?.data) return page;

  // Wallet-level spam context for the resource's detector call: a name
  // repeated across the page is a mass drop, which no single item can see.
  locals.nftNameCounts = spamDetector.countNames(page.data);

  return { ...page, data: await metadataHydrator.hydrateMany(page.data, locals) };
};

/**
 * True when a decorated NFT resource should be treated as spam (blacklisted,
 * or `spamScore` at or above the detector's `SPAM_THRESHOLD`).
 *
 * @param {Object} nft - Decorated NFT resource.
 * @returns {boolean}
 */
const isSpamNft = (nft) => nft?.blacklisted === true || spamDetector.isSpamScore(nft?.spamScore);

/**
 * Spam filtering policy for the NFT listing: drops `null` entries (fungible
 * tokens rejected by the resource) and, unless `includeSpam` is true, drops
 * blacklisted / spam-scored NFTs. `hidden` counts what this call dropped, so
 * the wallet can tell a short page from an empty wallet.
 *
 * @param {Array<Object|null>} decoratedNfts - Decorated NFT resources.
 * @param {boolean} [includeSpam=false] - When true, spam NFTs are kept.
 * @returns {{data: Array<Object>, hidden: {spam: number, fungible: number}}}
 */
const filterSpam = (decoratedNfts, includeSpam = false) => {
  const hidden = { spam: 0, fungible: 0 };
  const data = decoratedNfts.filter((nft) => {
    if (!nft) {
      hidden.fungible += 1;
      return false;
    }
    if (!includeSpam && isSpamNft(nft)) {
      hidden.spam += 1;
      return false;
    }
    return true;
  });

  return { data, hidden };
};

/**
 * Look up a single NFT by mint address.
 * @param {string} mintAddress
 * @param {Object} locals
 * @returns {Promise<Object|null>}
 */
const find = async (mintAddress, locals) => {
  const nft = await repository.findByAddress(mintAddress, locals);
  if (!nft) return nft;

  return metadataHydrator.hydrate(nft, locals);
};

/**
 * Rejects a request whose caller is not the asset's current owner.
 *
 * The indexer already tells us who holds the asset, so this costs nothing and
 * catches the case before any builder runs. It matters most for the
 * print-edition path, which assembles a raw SPL Burn + closeAccount from the
 * caller's associated token address without ever checking who owns the mint:
 * a non-owner got a 200 and a transaction that then fails on chain for a
 * reason unrelated to what they actually did wrong. The compressed and pNFT
 * paths already answer 422 here.
 *
 * `owner` is only compared when the indexer reports one — an asset whose
 * ownership we cannot read keeps its previous behaviour rather than being
 * blocked on missing data.
 *
 * @param {Object} nft - Provider-normalized asset.
 * @param {string} owner - Caller-supplied owner.
 * @param {Function} ErrorClass - Domain error to raise.
 * @param {string} action - Verb for the message ('burn' / 'transfer').
 * @returns {void}
 */
const assertOwnership = (nft, owner, ErrorClass, action) => {
  if (!nft?.owner || nft.owner === owner) return;

  throw new ErrorClass(`Only the current owner can ${action} this NFT.`);
};

/**
 * Build an unsigned burn transaction for an NFT, routing by token standard:
 *
 *   compressed → cNFT burn (Bubblegum)
 *   programmable → pNFT burn
 *   edition → printed-edition burn (needs ATA)
 *   master edition / legacy → master-edition burn
 *   anything else → throws UnsupportedSolanaNftBurnError
 *
 * Throws SolanaNftNotFoundError if the mint cannot be resolved.
 *
 * @param {string} mintAddress
 * @param {string} owner
 * @param {Object} locals
 * @returns {Promise<Object>} Serialized burn transaction.
 */
const createBurnTransaction = async (mintAddress, owner, locals) => {
  const nft = await repository.findFromSourceWithMint(mintAddress, locals);
  if (!nft) {
    throw new SolanaNftNotFoundError(mintAddress);
  }

  if (isFungibleToken(nft)) {
    throw new UnsupportedSolanaNftBurnError(
      `NFT burn is not supported for token standard "${nft.tokenStandard || 'unknown'}".`
    );
  }

  assertOwnership(nft, owner, UnsupportedSolanaNftBurnError, 'burn');

  if (nft.compressed) {
    return burnService.burnCompressedNftTransaction(mintAddress, owner, locals);
  }

  if (isProgrammableToken(nft.tokenStandard)) {
    return burnService.burnProgrammableNftTransaction(mintAddress, owner, locals);
  }

  if (isEditionToken(nft)) {
    const ata = await addressService.findAssociatedTokenAddress(owner, mintAddress);
    return burnService.burnEditionsTransaction(mintAddress, ata, owner, locals);
  }

  if (isMasterEditionToken(nft)) {
    return burnService.burnMasterEditionTransaction(mintAddress, owner, locals);
  }

  throw new UnsupportedSolanaNftBurnError(
    `NFT burn is not supported for token standard "${nft.tokenStandard || 'unknown'}".`
  );
};

/**
 * Build an unsigned transfer transaction for an NFT.
 *
 * Routes compressed assets to Bubblegum and everything else to Token Metadata's
 * `transferV1`, which is the unified instruction across token standards — it
 * covers both classic NonFungible and ProgrammableNonFungible. A plain SPL
 * transfer is deliberately NOT used: it fails on pNFTs with `Account is frozen`.
 *
 * @param {string} mintAddress - Mint of the NFT to send.
 * @param {string} owner - Current owner; signs and pays.
 * @param {string} destination - Recipient wallet address.
 * @param {Object} locals - Request locals.
 * @returns {Promise<Object>} Serialized transaction for the client to sign.
 * @throws {SolanaNftNotFoundError} If the mint is unknown to the indexer.
 */
const createTransferTransaction = async (mintAddress, owner, destination, locals) => {
  const nft = await repository.findFromSourceWithMint(mintAddress, locals);
  if (!nft) {
    throw new SolanaNftNotFoundError(mintAddress);
  }

  if (
    isFungibleToken(nft) ||
    NON_TRANSFERABLE_TOKEN_STANDARDS.includes(normalizeTokenStandard(nft.tokenStandard))
  ) {
    throw new UnsupportedSolanaNftTransferError(
      `NFT transfer is not supported for token standard "${nft.tokenStandard || 'unknown'}".`
    );
  }

  assertOwnership(nft, owner, UnsupportedSolanaNftTransferError, 'transfer');

  if (nft.compressed) {
    return transferService.transferCompressedNftTransaction(
      mintAddress,
      owner,
      destination,
      locals
    );
  }

  return transferService.transferNftTransaction(mintAddress, owner, destination, locals);
};

module.exports = {
  list,
  filterSpam,
  find,
  createBurnTransaction,
  createTransferTransaction,
};
