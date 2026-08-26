'use strict';

class SolanaNftTransferError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

class UnsupportedSolanaNftTransferError extends SolanaNftTransferError {
  constructor(message) {
    super(message, 422, 'transfer_not_supported');
  }
}

class OversizedSolanaNftTransferTransactionError extends SolanaNftTransferError {
  constructor(size) {
    super(
      `Transfer transaction exceeds Solana's 1232-byte transaction limit for this asset (${size} bytes).`,
      422,
      'transfer_transaction_too_large'
    );
  }
}

module.exports = {
  SolanaNftTransferError,
  UnsupportedSolanaNftTransferError,
  OversizedSolanaNftTransferTransactionError,
};
