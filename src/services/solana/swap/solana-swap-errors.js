'use strict';

/** Swap-domain error carrying the status + code the error middleware renders. */
class SolanaSwapError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/** The provider could not route the pair/amount; its own reason travels in the message. */
class SolanaSwapNoRouteError extends SolanaSwapError {
  constructor(reason) {
    super(reason || 'No route available', 404, 'no_route');
  }
}

/** Salmon's fee token account for the fee mint does not exist; never swap fee-less. */
class SolanaSwapFeeAccountMissingError extends SolanaSwapError {
  constructor(feeAccount, mint) {
    super(
      `Fee token account ${feeAccount} for mint ${mint} does not exist`,
      503,
      'fee_account_missing'
    );
  }
}

/** The built transaction does not carry the configured fee; refuse to return it. */
class SolanaSwapFeeMismatchError extends SolanaSwapError {
  constructor(feeAccount) {
    super(
      `Provider transaction does not reference fee account ${feeAccount}`,
      502,
      'provider_fee_mismatch'
    );
  }
}

module.exports = {
  SolanaSwapError,
  SolanaSwapNoRouteError,
  SolanaSwapFeeAccountMissingError,
  SolanaSwapFeeMismatchError,
};
