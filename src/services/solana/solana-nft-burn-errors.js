'use strict';

/**
 * Error taxonomy for the NFT burn flow (`burn-service.js`,
 * `solana-nft-service.js`). Each subclass pins an HTTP status code and a
 * stable `errorCode` string so `solana-nft-burn` controllers/resources can
 * translate a thrown error into the documented error envelope without
 * inspecting message text:
 *
 *   - `SolanaNftNotFoundError` (404, `nft_not_found`) — mint could not be
 *     resolved to an NFT.
 *   - `UnsupportedSolanaNftBurnError` (422, `burn_not_supported`) — token
 *     standard / edition combination this flow does not know how to burn.
 *   - `OversizedSolanaNftBurnTransactionError` (422,
 *     `burn_transaction_too_large`) — burn exceeds Solana's 1232-byte
 *     transaction limit even after the address-lookup-table fallback.
 */
class SolanaNftBurnError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/** Mint could not be resolved to an NFT. Maps to 404 `nft_not_found`. */
class SolanaNftNotFoundError extends SolanaNftBurnError {
  constructor(mintAddress) {
    super(`NFT not found for mint ${mintAddress}.`, 404, 'nft_not_found');
  }
}

/** Token standard/edition combination this flow cannot burn. Maps to 422 `burn_not_supported`. */
class UnsupportedSolanaNftBurnError extends SolanaNftBurnError {
  constructor(message) {
    super(message, 422, 'burn_not_supported');
  }
}

/** Burn exceeds Solana's 1232-byte tx limit even after the lookup-table fallback. Maps to 422 `burn_transaction_too_large`. */
class OversizedSolanaNftBurnTransactionError extends SolanaNftBurnError {
  constructor(size) {
    super(
      `Burn transaction exceeds Solana's 1232-byte transaction limit for this asset (${size} bytes). This asset likely requires address lookup tables to burn.`,
      422,
      'burn_transaction_too_large'
    );
  }
}

module.exports = {
  SolanaNftBurnError,
  SolanaNftNotFoundError,
  UnsupportedSolanaNftBurnError,
  OversizedSolanaNftBurnTransactionError,
};
