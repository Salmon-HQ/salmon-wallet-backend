'use strict';

/**
 * Dagon's instruction layouts, PDAs and account readers, transcribed from
 * Dagon's pc-wallet-kit (epoch 2: `reference/pcSwap.ts`, the vendored
 * pc-token `instructions.ts`, GUIDE.md; research R6–R7). Pure: no I/O.
 *
 * Byte offsets are program layout, pinned with the program ids in
 * `config.js`, so they live here as constants and never come from the
 * remote `devnet.json`. Each builder takes the accepted config and names
 * at most one fresh key (the device-generated ciphertext account) as a
 * signer besides the payer.
 */

const { PublicKey, SystemProgram, TransactionInstruction } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const { ENCRYPT_PROGRAM_ID, PC_SWAP_PROGRAM_ID, PC_TOKEN_PROGRAM_ID } = require('./config');

const ENCRYPT = new PublicKey(ENCRYPT_PROGRAM_ID);
const PC_TOKEN = new PublicKey(PC_TOKEN_PROGRAM_ID);
const PC_SWAP = new PublicKey(PC_SWAP_PROGRAM_ID);
const SYSTEM = SystemProgram.programId;

const PC_ACCOUNT_LEN = 202;
const RECEIPT_LEN = 203;
const CIPHERTEXT_MIN_LEN = 100;
const CIPHERTEXT_STATUS = 99;
const FEE_VAULT_OFFSET = 100;

const find = (seeds, programId) => PublicKey.findProgramAddressSync(seeds, programId);
const key = (value) => (value instanceof PublicKey ? value : new PublicKey(value));

const pda = {
  encryptConfig: () => find([Buffer.from('encrypt_config')], ENCRYPT),
  eventAuthority: () => find([Buffer.from('__event_authority')], ENCRYPT),
  encryptDeposit: (payer) => find([Buffer.from('encrypt_deposit'), payer.toBuffer()], ENCRYPT),
  networkKey: (config) =>
    find(
      [Buffer.from('network_encryption_key'), Buffer.from(config.networkKeyHex, 'hex')],
      ENCRYPT
    ),
  cpiAuthority: (programId) => find([Buffer.from('__encrypt_cpi_authority')], programId),
  pcAccount: (pcMint, owner) =>
    find([Buffer.from('pc_account'), pcMint.toBuffer(), owner.toBuffer()], PC_TOKEN),
  receipt: (burnedCt) => find([Buffer.from('pc_receipt'), burnedCt.toBuffer()], PC_TOKEN),
};

const ro = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
const w = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
const fresh = (pubkey) => ({ pubkey, isSigner: true, isWritable: true });

/** The nine accounts every pc-token instruction but UnwrapComplete ends with. */
const encryptTail = (config, payer) => [
  ro(ENCRYPT),
  w(pda.encryptConfig()[0]),
  w(pda.encryptDeposit(payer)[0]),
  ro(pda.cpiAuthority(PC_TOKEN)[0]),
  ro(PC_TOKEN),
  ro(pda.networkKey(config)[0]),
  fresh(payer),
  ro(pda.eventAuthority()[0]),
  ro(SYSTEM),
];

const pcToken = (data, keys) => new TransactionInstruction({ programId: PC_TOKEN, data, keys });
const tokenCpiBump = () => pda.cpiAuthority(PC_TOKEN)[1];
const withAmount = (prefix, amount) => {
  const data = Buffer.alloc(prefix.length + 8);
  Buffer.from(prefix).copy(data);
  data.writeBigUInt64LE(amount, prefix.length);
  return data;
};

/** The fee vault `create_deposit` pays: the config's, or the payer when that is the System Program. */
const readFeeVault = (encryptConfigData, payer) => {
  const vault = new PublicKey(encryptConfigData.subarray(FEE_VAULT_OFFSET, FEE_VAULT_OFFSET + 32));
  return vault.equals(SYSTEM) ? payer : vault;
};

const createDeposit = (config, { payer, feeVault }) => {
  const [deposit, depositBump] = pda.encryptDeposit(payer);
  const data = Buffer.alloc(18);
  data[0] = 14;
  data[1] = depositBump;
  return new TransactionInstruction({
    programId: ENCRYPT,
    data,
    keys: [
      w(deposit),
      ro(pda.encryptConfig()[0]),
      { pubkey: payer, isSigner: true, isWritable: false },
      fresh(payer),
      fresh(payer),
      { pubkey: feeVault, isSigner: feeVault.equals(payer), isWritable: true },
      ro(SYSTEM),
      ro(SYSTEM),
    ],
  });
};

const initializeAccount = (config, { payer, owner, side, balanceCt }) => {
  const [account, accountBump] = pda.pcAccount(key(side.pcMint), owner);
  return pcToken(Buffer.from([1, accountBump, tokenCpiBump()]), [
    w(account),
    ro(key(side.pcMint)),
    ro(owner),
    fresh(balanceCt),
    ...encryptTail(config, payer),
  ]);
};

const wrap = (config, { payer, side, balanceCt, amountCt, amount }) =>
  pcToken(withAmount([30, tokenCpiBump()], amount), [
    ro(key(side.vault)),
    ro(pda.pcAccount(key(side.pcMint), payer)[0]),
    w(getAssociatedTokenAddressSync(key(side.splMint), payer)),
    w(key(side.vaultAta)),
    w(balanceCt),
    fresh(amountCt),
    ...encryptTail(config, payer),
    ro(TOKEN_PROGRAM_ID),
  ]);

const viewBalance = (config, { payer, side, balanceCt, viewCt, viewer }) =>
  pcToken(Buffer.from([40, tokenCpiBump()]), [
    ro(pda.pcAccount(key(side.pcMint), payer)[0]),
    ro(balanceCt),
    fresh(viewCt),
    ro(viewer),
    ...encryptTail(config, payer),
  ]);

const transfer = (config, { payer, to, side, fromBalanceCt, toBalanceCt, amountCt }) =>
  pcToken(Buffer.from([3, tokenCpiBump()]), [
    ro(pda.pcAccount(key(side.pcMint), payer)[0]),
    ro(pda.pcAccount(key(side.pcMint), to)[0]),
    w(fromBalanceCt),
    w(toBalanceCt),
    w(amountCt),
    ...encryptTail(config, payer),
  ]);

/** Pool accounts ordered input first: direction 0 when the input is the pool's side A. */
const poolLegs = (config, sideIn) => {
  const { pool } = config;
  const aIn = sideIn === pool.sideA;
  const pair = (a, b) => (aIn ? [key(a), key(b)] : [key(b), key(a)]);
  return {
    direction: aIn ? 0 : 1,
    vaults: pair(pool.vaultAccountA, pool.vaultAccountB),
    vaultBalanceCts: pair(pool.vaultBalanceCtA, pool.vaultBalanceCtB),
    reserves: pair(pool.reserveCtA, pool.reserveCtB),
  };
};

/** The two pool reserves the swap reads, input side first. */
const swapReserves = (config, sideIn) => poolLegs(config, sideIn).reserves;

const swap = (
  config,
  {
    payer,
    sideIn,
    sideOut,
    userInBalCt,
    userOutBalCt,
    amountInCt,
    minOutCt,
    amountOutCt,
    receiptCt,
  }
) => {
  const legs = poolLegs(config, sideIn);
  const [swapCpi, swapCpiBump] = pda.cpiAuthority(PC_SWAP);
  return new TransactionInstruction({
    programId: PC_SWAP,
    data: Buffer.from([1, swapCpiBump, tokenCpiBump(), legs.direction]),
    keys: [
      w(key(config.pool.address)),
      w(pda.pcAccount(key(config.sides[sideIn].pcMint), payer)[0]),
      w(pda.pcAccount(key(config.sides[sideOut].pcMint), payer)[0]),
      ...legs.vaults.map(w),
      w(userInBalCt),
      w(userOutBalCt),
      ...legs.vaultBalanceCts.map(w),
      ...legs.reserves.map(w),
      w(amountInCt),
      w(minOutCt),
      w(amountOutCt),
      fresh(receiptCt),
      ro(ENCRYPT),
      w(pda.encryptConfig()[0]),
      w(pda.encryptDeposit(payer)[0]),
      ro(swapCpi),
      ro(PC_SWAP),
      ro(pda.cpiAuthority(PC_TOKEN)[0]),
      ro(PC_TOKEN),
      ro(pda.networkKey(config)[0]),
      fresh(payer),
      ro(pda.eventAuthority()[0]),
      ro(SYSTEM),
    ],
  });
};

const unwrapBurn = (config, { payer, side, balanceCt, amountCt, burnedCt, amount }) => {
  const [receipt, receiptBump] = pda.receipt(burnedCt);
  return pcToken(withAmount([31, receiptBump, tokenCpiBump()], amount), [
    ro(key(side.vault)),
    w(pda.pcAccount(key(side.pcMint), payer)[0]),
    w(receipt),
    w(balanceCt),
    w(amountCt),
    fresh(burnedCt),
    ...encryptTail(config, payer),
  ]);
};

/** The Encrypt config is read-only here, as in the vendored builder. */
const unwrapDecrypt = (config, { payer, receipt, requestAcct, burnedCt }) => {
  const configPda = pda.encryptConfig()[0];
  return pcToken(Buffer.from([32, tokenCpiBump()]), [
    w(receipt),
    fresh(requestAcct),
    ro(burnedCt),
    ...encryptTail(config, payer).map((meta) =>
      meta.pubkey.equals(configPda) ? ro(configPda) : meta
    ),
  ]);
};

const unwrapComplete = (config, { owner, side, receipt, requestAcct }) =>
  pcToken(Buffer.from([33]), [
    w(receipt),
    ro(key(side.vault)),
    ro(key(side.pcMint)),
    ro(requestAcct),
    w(key(side.vaultAta)),
    w(getAssociatedTokenAddressSync(key(side.splMint), owner)),
    { pubkey: owner, isSigner: true, isWritable: false },
    w(owner),
    ro(TOKEN_PROGRAM_ID),
  ]);

const at = (data, offset) => new PublicKey(data.subarray(offset, offset + 32));

/** pc-account (`TokenAccount`): mint, owner, balance ciphertext. Null on any other length. */
const readPcAccount = (data) =>
  data.length === PC_ACCOUNT_LEN
    ? { mint: at(data, 0), owner: at(data, 32), balanceCt: at(data, 64) }
    : null;

/** Ciphertext: digest `[2..34]`, status `[99]` (1 committed). An all-zero digest was never committed. */
const readCiphertextStatus = (data) => {
  if (data.length < CIPHERTEXT_MIN_LEN) return null;
  const digest = Buffer.from(data.subarray(2, 34));
  return {
    digest,
    committed: data[CIPHERTEXT_STATUS] === 1,
    neverCommitted: digest.every((byte) => byte === 0),
  };
};

/** WithdrawalReceipt (203 bytes). Null on any other length. */
const readReceipt = (data) =>
  data.length === RECEIPT_LEN
    ? {
        owner: at(data, 0),
        amount: data.readBigUInt64LE(32),
        burnedCt: at(data, 73),
        vault: at(data, 105),
        pcMint: at(data, 137),
        request: at(data, 169),
        decryptRequested: data[201] !== 0,
      }
    : null;

module.exports = {
  pda,
  readFeeVault,
  createDeposit,
  initializeAccount,
  wrap,
  viewBalance,
  transfer,
  swap,
  swapReserves,
  unwrapBurn,
  unwrapDecrypt,
  unwrapComplete,
  readPcAccount,
  readCiphertextStatus,
  readReceipt,
};
