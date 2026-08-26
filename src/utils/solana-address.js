'use strict';

/**
 * Base58 address validation for Solana request parameters.
 *
 * Without it, a malformed address reaches `new PublicKey(...)` deep inside a
 * service and surfaces as `500 server_error` ("Non-base58 character"): the
 * caller cannot tell their input was wrong, and every typo is recorded as a
 * backend incident. Validating at the controller turns that into a 400 and
 * saves the upstream call.
 */

const { PublicKey } = require('@solana/web3.js');

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` is a valid base58 Solana public key.
 */
const isValidSolanaAddress = (value) => {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Finds the first invalid address among the given `{name: value}` pairs.
 * Absent values are ignored — required-ness is the caller's decision, this
 * only rules on the values that were actually supplied.
 *
 * @param {Object<string, unknown>} params
 * @returns {string|null} the offending parameter name, or null when all valid.
 */
const findInvalidAddressParam = (params) => {
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (!isValidSolanaAddress(value)) return name;
  }
  return null;
};

module.exports = { isValidSolanaAddress, findInvalidAddressParam };
