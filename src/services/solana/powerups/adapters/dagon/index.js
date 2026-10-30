'use strict';

/**
 * `dagon` — Dagon's private tokens on Solana devnet (pc-token / pc-swap on
 * Encrypt's pre-alpha executor): setup, wrap, reveal, send, swap and the
 * three unwrap steps, each an unsigned transaction the device signs.
 *
 * Programs refuse any new ciphertext account that is not a fresh signer, so
 * the device generates one public key per transaction and passes it in
 * `freshSigners`; the backend only names it. It never sees a private key
 * (root `AGENTS.md` "Signing boundary"). How many fresh keys each action
 * takes is `FRESH_SIGNERS`, the same map the registry entry declares to the
 * build service's signer check.
 */

const { isValidSolanaAddress } = require('../../../../../utils/solana-address');
const { ENCRYPT_PROGRAM_ID, PC_SWAP_PROGRAM_ID, PC_TOKEN_PROGRAM_ID } = require('./config');

const FRESH_SIGNERS = Object.freeze({
  setup: 1,
  wrap: 1,
  reveal: 1,
  send: 0,
  swap: 1,
  unwrapBurn: 1,
  unwrapDecrypt: 1,
  unwrapComplete: 0,
});

const REQUIRED = {
  setup: ['side'],
  wrap: ['side', 'amount'],
  reveal: ['side', 'viewer'],
  send: ['side', 'amount', 'to'],
  swap: ['sideIn', 'sideOut', 'amountIn', 'minAmountOut'],
  unwrapBurn: ['side', 'amount'],
  unwrapDecrypt: ['burnedCt'],
  unwrapComplete: ['burnedCt', 'requestAcct'],
};
const OPTIONAL = { setup: ['owner'] };
const AMOUNTS = ['amount', 'amountIn', 'minAmountOut'];
const ADDRESSES = ['owner', 'viewer', 'to', 'burnedCt', 'requestAcct'];
const U64_LIMIT = 2n ** 64n;
/** The backend never takes key material or signed bytes (FR-008). */
const SECRET_LIKE = /secret|private|seed|mnemonic|keypair|signed/i;

const fail = (error, description) => ({ error, error_description: description });

const parseFreshSigners = (raw, action, others) => {
  if (typeof raw !== 'string') return null;
  const keys = raw === '' ? [] : raw.split(',');
  const valid =
    keys.every(isValidSolanaAddress) &&
    new Set(keys).size === keys.length &&
    keys.length === FRESH_SIGNERS[action] &&
    !keys.some((key) => others.includes(key));
  return valid ? keys : null;
};

/**
 * `{ params }` or a 400 envelope. Synchronous and without I/O: everything
 * that needs chain state or the Dagon config is checked in `build`.
 * @param {Object} query - raw query; `publicKey` already validated by the controller
 */
const validate = (query) => {
  if (Object.keys(query).some((key) => SECRET_LIKE.test(key))) {
    return fail('invalid_parameter', 'Key material and signed transactions are never accepted');
  }
  const { action, publicKey } = query;
  if (action === undefined || action === '') {
    return fail('missing_parameter', 'Missing required query params: action');
  }
  if (!Object.hasOwn(REQUIRED, action)) {
    return fail('invalid_parameter', `action must be one of ${Object.keys(REQUIRED).join(', ')}`);
  }

  const fields = [...REQUIRED[action], ...(OPTIONAL[action] || [])];
  const missing = [...REQUIRED[action], 'freshSigners'].filter(
    (field) => query[field] === undefined || (query[field] === '' && field !== 'freshSigners')
  );
  if (missing.length > 0) {
    return fail('missing_parameter', `Missing required query params: ${missing.join(', ')}`);
  }

  const params = { action, publicKey };
  for (const field of fields) {
    const value = query[field];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string') {
      return fail('invalid_parameter', `${field} must be given once, as a string`);
    }
    if (AMOUNTS.includes(field)) {
      const amount = /^\d+$/.test(value) ? BigInt(value) : 0n;
      if (amount < 1n || amount >= U64_LIMIT) {
        return fail(
          'invalid_parameter',
          `${field} must be a whole number of base units, 1 to 2^64-1`
        );
      }
      params[field] = amount;
    } else if (ADDRESSES.includes(field) && !isValidSolanaAddress(value)) {
      return fail('invalid_parameter', `${field} is not a valid Solana address`);
    } else {
      params[field] = value;
    }
  }
  if (action === 'setup') params.owner = params.owner || publicKey;
  if (params.viewer === publicKey || params.to === publicKey) {
    return fail('invalid_parameter', 'The viewer or recipient must be another wallet');
  }

  const others = [publicKey, ...ADDRESSES.map((field) => params[field]).filter(Boolean)];
  const freshSigners = parseFreshSigners(query.freshSigners, action, others);
  if (!freshSigners) {
    return fail(
      'invalid_fresh_signers',
      `freshSigners must be ${FRESH_SIGNERS[action]} new comma-separated public keys, distinct from every other key in the request`
    );
  }
  return { params: { ...params, freshSigners } };
};

module.exports = {
  validate,
  FRESH_SIGNERS,
  PC_TOKEN_PROGRAM_ID,
  PC_SWAP_PROGRAM_ID,
  ENCRYPT_PROGRAM_ID,
};
