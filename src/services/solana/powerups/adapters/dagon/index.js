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

const { PublicKey } = require('@solana/web3.js');
const { isValidSolanaAddress } = require('../../../../../utils/solana-address');
const { PowerupError } = require('../../powerup-errors');
const {
  ENCRYPT_PROGRAM_ID,
  PC_SWAP_PROGRAM_ID,
  PC_TOKEN_PROGRAM_ID,
  getConfig,
} = require('./config');
const ix = require('./instructions');
const executor = require('./executor');

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

const PROVIDER = { id: 'dagon', displayName: 'Dagon (devnet preview)', attribution: null };
const COMMITMENT = 'confirmed';

const refuse = (statusCode, errorCode, message) => new PowerupError(message, statusCode, errorCode);

const sideOf = (config, name) => {
  if (!Object.hasOwn(config.sides, name)) {
    throw refuse(400, 'invalid_parameter', 'side is not one of the Dagon devnet tokens');
  }
  return config.sides[name];
};

/**
 * One read for the action's chain state and the fresh keys: a fresh key that
 * already exists is refused before any executor input is spent on it (R8).
 */
const readAccounts = async (connection, fresh, accounts) => {
  const infos = await connection.getMultipleAccountsInfo([...fresh, ...accounts], COMMITMENT);
  if (infos.slice(0, fresh.length).some(Boolean)) {
    throw refuse(400, 'invalid_fresh_signers', 'A fresh signer already exists on chain');
  }
  return infos.slice(fresh.length);
};

/** The balance ciphertext of a pc-account, or a 409 when the wallet has none for this side. */
const balanceCtOf = (info, errorCode = 'setup_required') => {
  const account = info && ix.readPcAccount(info.data);
  if (!account) {
    throw refuse(
      409,
      errorCode,
      errorCode === 'setup_required'
        ? 'Set up this Dagon token first'
        : 'The recipient has not set up this Dagon token'
    );
  }
  return account.balanceCt;
};

const setup = async ({ config, payer, fresh: [balanceCt], params, connection }) => {
  const side = sideOf(config, params.side);
  const owner = new PublicKey(params.owner);
  const [pcAccount, deposit, encryptConfig] = await readAccounts(
    connection,
    [balanceCt],
    [
      ix.pda.pcAccount(new PublicKey(side.pcMint), owner)[0],
      ix.pda.encryptDeposit(payer)[0],
      ix.pda.encryptConfig()[0],
    ]
  );
  if (pcAccount) {
    throw refuse(409, 'already_initialized', 'This wallet already holds this Dagon token');
  }
  const instructions = [];
  if (!deposit) {
    if (!encryptConfig) {
      throw refuse(503, 'dagon_config_unavailable', 'Encrypt is not initialized on devnet');
    }
    const feeVault = ix.readFeeVault(encryptConfig.data, payer);
    instructions.push(ix.createDeposit(config, { payer, feeVault }));
  }
  instructions.push(ix.initializeAccount(config, { payer, owner, side, balanceCt }));
  return { instructions, display: { side: params.side, owner: params.owner } };
};

const wrap = async ({ config, payer, fresh: [amountCt], params, connection }) => {
  const side = sideOf(config, params.side);
  const [pcAccount] = await readAccounts(
    connection,
    [amountCt],
    [ix.pda.pcAccount(new PublicKey(side.pcMint), payer)[0]]
  );
  const balanceCt = balanceCtOf(pcAccount);
  return {
    instructions: [ix.wrap(config, { payer, side, balanceCt, amountCt, amount: params.amount })],
    display: { side: params.side, amount: params.amount.toString() },
  };
};

/** The balance is copied to the fresh key for the viewer; its value is never read here. */
const reveal = async ({ config, payer, fresh: [viewCt], params, connection }) => {
  const side = sideOf(config, params.side);
  const [pcAccount] = await readAccounts(
    connection,
    [viewCt],
    [ix.pda.pcAccount(new PublicKey(side.pcMint), payer)[0]]
  );
  const balanceCt = balanceCtOf(pcAccount);
  const viewer = new PublicKey(params.viewer);
  return {
    instructions: [ix.viewBalance(config, { payer, side, balanceCt, viewCt, viewer })],
    display: { side: params.side },
  };
};

/** A balance the executor has not committed (pending, never written, or absent) would compute on nothing. */
const assertSettled = (info) => {
  const status = info && ix.readCiphertextStatus(info.data);
  if (!status || !status.committed || status.neverCommitted) {
    throw refuse(409, 'balance_settling', 'The balance is still settling, please retry shortly');
  }
};

/** Both pc-accounts are required (spec OQ2); nothing is prepended to the swap. */
const swap = async ({ config, payer, fresh: [receiptCt], params, connection, locals }) => {
  const { sideIn, sideOut } = params;
  const inSide = sideOf(config, sideIn);
  const outSide = sideOf(config, sideOut);
  const poolSides = [config.pool.sideA, config.pool.sideB];
  if (sideIn === sideOut || !poolSides.includes(sideIn) || !poolSides.includes(sideOut)) {
    throw refuse(400, 'invalid_parameter', 'sideIn and sideOut must be the two sides of the pool');
  }
  const [pool, userIn, userOut] = await readAccounts(
    connection,
    [receiptCt],
    [
      new PublicKey(config.pool.address),
      ix.pda.pcAccount(new PublicKey(inSide.pcMint), payer)[0],
      ix.pda.pcAccount(new PublicKey(outSide.pcMint), payer)[0],
    ]
  );
  if (!pool) {
    throw refuse(503, 'pool_unavailable', 'The Dagon pool is unavailable');
  }
  const userInBalCt = balanceCtOf(userIn);
  const userOutBalCt = balanceCtOf(userOut);
  const [inBalance] = await connection.getMultipleAccountsInfo([userInBalCt], COMMITMENT);
  assertSettled(inBalance);

  const [amountInCt, minOutCt, amountOutCt] = await executor.createInputs(
    [params.amountIn, params.minAmountOut, 0n],
    PC_SWAP_PROGRAM_ID,
    config,
    locals
  );
  await executor.waitCommitted(
    connection,
    [amountInCt, minOutCt, amountOutCt],
    ix.swapReserves(config, sideIn),
    locals
  );
  return {
    instructions: [
      ix.swap(config, {
        payer,
        sideIn,
        sideOut,
        userInBalCt,
        userOutBalCt,
        amountInCt,
        minOutCt,
        amountOutCt,
        receiptCt,
      }),
    ],
    display: {
      sideIn,
      sideOut,
      amountIn: params.amountIn.toString(),
      minAmountOut: params.minAmountOut.toString(),
    },
  };
};

/** A first-time recipient is set up by its own `setup` (owner = recipient), never inside the transfer (spec OQ3). */
const send = async ({ config, payer, params, connection, locals }) => {
  const side = sideOf(config, params.side);
  const to = new PublicKey(params.to);
  const [from, recipient] = await readAccounts(
    connection,
    [],
    [
      ix.pda.pcAccount(new PublicKey(side.pcMint), payer)[0],
      ix.pda.pcAccount(new PublicKey(side.pcMint), to)[0],
    ]
  );
  const fromBalanceCt = balanceCtOf(from);
  const toBalanceCt = balanceCtOf(recipient, 'recipient_setup_required');
  const [fromBalance] = await connection.getMultipleAccountsInfo([fromBalanceCt], COMMITMENT);
  assertSettled(fromBalance);

  const [amountCt] = await executor.createInputs(
    [params.amount],
    PC_TOKEN_PROGRAM_ID,
    config,
    locals
  );
  await executor.waitCommitted(connection, [amountCt], [], locals);
  return {
    instructions: [ix.transfer(config, { payer, to, side, fromBalanceCt, toBalanceCt, amountCt })],
    display: { side: params.side, amount: params.amount.toString(), recipient: params.to },
  };
};

const unwrapBurn = async ({ config, payer, fresh: [burnedCt], params, connection, locals }) => {
  const side = sideOf(config, params.side);
  const [pcAccount] = await readAccounts(
    connection,
    [burnedCt],
    [ix.pda.pcAccount(new PublicKey(side.pcMint), payer)[0]]
  );
  const balanceCt = balanceCtOf(pcAccount);
  const [amountCt] = await executor.createInputs(
    [params.amount],
    PC_TOKEN_PROGRAM_ID,
    config,
    locals
  );
  await executor.waitCommitted(connection, [amountCt], [], locals);
  return {
    instructions: [
      ix.unwrapBurn(config, { payer, side, balanceCt, amountCt, burnedCt, amount: params.amount }),
    ],
    display: { side: params.side, amount: params.amount.toString() },
  };
};

/** The caller's withdrawal receipt and the side its pc-mint belongs to, or 409 `receipt_not_found`. */
const receiptOf = (config, info, payer) => {
  const receipt = info && ix.readReceipt(info.data);
  const side =
    receipt &&
    Object.keys(config.sides).find((name) =>
      receipt.pcMint.equals(new PublicKey(config.sides[name].pcMint))
    );
  if (!receipt || !receipt.owner.equals(payer) || !side) {
    throw refuse(409, 'receipt_not_found', 'No withdrawal receipt of this wallet for burnedCt');
  }
  return { receipt, side };
};

/**
 * A decryption requested before the burn commits may read the old value, and
 * UnwrapComplete would then close the receipt releasing nothing (FR-030).
 */
const unwrapDecrypt = async ({ config, payer, fresh: [requestAcct], params, connection }) => {
  const burnedCt = new PublicKey(params.burnedCt);
  const receiptAddress = ix.pda.receipt(burnedCt)[0];
  const [receiptInfo, burned] = await readAccounts(
    connection,
    [requestAcct],
    [receiptAddress, burnedCt]
  );
  const { receipt, side } = receiptOf(config, receiptInfo, payer);
  if (receipt.decryptRequested) {
    throw refuse(409, 'already_requested', 'The decryption for this receipt was already requested');
  }
  const status = burned && ix.readCiphertextStatus(burned.data);
  if (!status || !status.committed) {
    throw refuse(409, 'balance_settling', 'The burn is still settling, please retry shortly');
  }
  return {
    instructions: [
      ix.unwrapDecrypt(config, { payer, receipt: receiptAddress, requestAcct, burnedCt }),
    ],
    display: { side },
  };
};

const unwrapComplete = async ({ config, payer, params, connection }) => {
  const receiptAddress = ix.pda.receipt(new PublicKey(params.burnedCt))[0];
  const [receiptInfo] = await readAccounts(connection, [], [receiptAddress]);
  const { receipt, side } = receiptOf(config, receiptInfo, payer);
  if (receipt.request.toBase58() !== params.requestAcct) {
    throw refuse(400, 'invalid_parameter', 'requestAcct is not the request this receipt names');
  }
  return {
    instructions: [
      ix.unwrapComplete(config, {
        owner: payer,
        side: config.sides[side],
        receipt: receiptAddress,
        requestAcct: receipt.request,
      }),
    ],
    display: { side },
  };
};

const ACTIONS = { setup, wrap, reveal, send, swap, unwrapBurn, unwrapDecrypt, unwrapComplete };

/**
 * Instructions for one validated action. The display names the request
 * only: the outcome of a private-token transaction is known after a reveal,
 * never at build time.
 * @param {Object} params - from `validate`
 * @param {{ locals: Object, connection: import('@solana/web3.js').Connection }} context
 */
const build = async (params, { locals, connection }) => {
  const config = await getConfig(locals);
  const { instructions, display } = await ACTIONS[params.action]({
    config,
    params,
    payer: new PublicKey(params.publicKey),
    fresh: params.freshSigners.map((address) => new PublicKey(address)),
    connection,
    locals,
  });
  const side = config.sides[display.side ?? display.sideIn];
  return {
    instructions,
    provider: PROVIDER,
    display: {
      action: params.action,
      ...display,
      decimals: side?.decimals ?? null,
      outcomeKnownAfterReveal: true,
    },
  };
};

module.exports = {
  validate,
  build,
  FRESH_SIGNERS,
  PC_TOKEN_PROGRAM_ID,
  PC_SWAP_PROGRAM_ID,
  ENCRYPT_PROGRAM_ID,
};
