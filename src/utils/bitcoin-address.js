'use strict';

/**
 * Syntactic Bitcoin address validation for request parameters, so a typo
 * answers 400 instead of reaching Blockdaemon and surfacing as a 500.
 * Shape only (no checksum): base58 P2PKH/P2SH on mainnet (`1`/`3`) and
 * testnet (`m`/`n`/`2`), or bech32/bech32m (`bc1`/`tb1`, lower-case).
 */

const BASE58_ADDRESS = /^[123mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BECH32_ADDRESS = /^(bc1|tb1)[a-z0-9]{25,62}$/;

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` looks like a Bitcoin address.
 */
const isValidBitcoinAddress = (value) =>
  typeof value === 'string' && (BASE58_ADDRESS.test(value) || BECH32_ADDRESS.test(value));

module.exports = { isValidBitcoinAddress };
