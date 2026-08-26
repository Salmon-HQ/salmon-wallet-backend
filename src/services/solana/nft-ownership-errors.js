'use strict';

/**
 * Translates Umi's account-not-found failure into a domain error.
 *
 * `fetchDigitalAssetWithAssociatedToken` throws a bare `AccountNotFoundError`
 * when the owner has no associated token account for the mint — which is what
 * "you do not own this NFT" looks like on chain. Left alone it surfaced as
 * `500 server_error` carrying the SDK's text and a derived ATA address, while
 * the compressed path already answered a clean 422 for the same situation.
 *
 * Umi does not export a stable error class for this, so the match is on the
 * account type the message names; anything else is re-thrown untouched.
 *
 * @param {Function} ErrorClass - domain error to raise (burn or transfer).
 * @param {string} message - user-facing message for the domain error.
 * @returns {(error: Error) => never}
 */
const rethrowAsOwnershipError = (ErrorClass, message) => (error) => {
  const text = error?.message || '';
  if (/account of type \[Token\] was not found/i.test(text)) {
    throw new ErrorClass(message);
  }

  throw error;
};

module.exports = { rethrowAsOwnershipError };
