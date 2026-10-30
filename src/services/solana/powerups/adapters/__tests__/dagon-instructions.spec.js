'use strict';

const { PublicKey, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const ix = require('../dagon/instructions');
const CONFIG = require('./fixtures/dagon-devnet-epoch2.json');

const key = (byte) => new PublicKey(Buffer.alloc(32, byte));
const PAYER = new PublicKey('86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY');
const FRESH = key(0xf1);
const OTHER = key(0x0b);
const CT_A = key(0xa1);
const CT_B = key(0xb2);
const CT_C = key(0xc3);

const ENCRYPT = new PublicKey(CONFIG.programs.encrypt);
const PC_TOKEN = new PublicKey(CONFIG.programs.pcToken);
const PC_SWAP = new PublicKey(CONFIG.programs.pcSwap);
const SYSTEM = SystemProgram.programId;
const USDC = CONFIG.sides.USDC;
const DOGE = CONFIG.sides.DOGE;
const pk = (address) => new PublicKey(address);

// Seeds from the kit's GUIDE.md "PDA derivations".
const find = (seeds, program) => PublicKey.findProgramAddressSync(seeds, program);
const [configPda] = find([Buffer.from('encrypt_config')], ENCRYPT);
const [eventAuthority] = find([Buffer.from('__event_authority')], ENCRYPT);
const [depositPda, depositBump] = find([Buffer.from('encrypt_deposit'), PAYER.toBuffer()], ENCRYPT);
const [networkKey] = find([Buffer.from('network_encryption_key'), Buffer.alloc(32, 0x55)], ENCRYPT);
const [tokenCpi, tokenCpiBump] = find([Buffer.from('__encrypt_cpi_authority')], PC_TOKEN);
const [swapCpi, swapCpiBump] = find([Buffer.from('__encrypt_cpi_authority')], PC_SWAP);
const pcAccount = (mint, owner) =>
  find([Buffer.from('pc_account'), pk(mint).toBuffer(), owner.toBuffer()], PC_TOKEN);

const RO = [false, false];
const W = [false, true];
const S = [true, false];
const SW = [true, true];
const meta = (pubkey, [isSigner, isWritable]) => [pubkey.toBase58(), isSigner, isWritable];
const metasOf = (instruction) =>
  instruction.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]);

/** The nine-account Encrypt tail (GUIDE.md "The common Encrypt account tail"). */
const tail = (payer = PAYER) => [
  meta(ENCRYPT, RO),
  meta(configPda, W),
  meta(depositPda, W),
  meta(tokenCpi, RO),
  meta(PC_TOKEN, RO),
  meta(networkKey, RO),
  meta(payer, SW),
  meta(eventAuthority, RO),
  meta(SYSTEM, RO),
];

const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
};

describe('dagon instructions', () => {
  it('derives every PDA from the GUIDE seeds', () => {
    expect(ix.pda.encryptConfig()[0]).toEqual(configPda);
    expect(ix.pda.eventAuthority()[0]).toEqual(eventAuthority);
    expect(ix.pda.encryptDeposit(PAYER)).toEqual([depositPda, depositBump]);
    expect(ix.pda.networkKey(CONFIG)[0]).toEqual(networkKey);
    expect(ix.pda.cpiAuthority(PC_TOKEN)).toEqual([tokenCpi, tokenCpiBump]);
    expect(ix.pda.cpiAuthority(PC_SWAP)).toEqual([swapCpi, swapCpiBump]);
    expect(ix.pda.pcAccount(pk(USDC.pcMint), PAYER)).toEqual(pcAccount(USDC.pcMint, PAYER));
    expect(ix.pda.receipt(FRESH)).toEqual(
      find([Buffer.from('pc_receipt'), FRESH.toBuffer()], PC_TOKEN)
    );
  });

  describe('create_deposit', () => {
    const encryptConfigData = (feeVault) => {
      const data = Buffer.alloc(140);
      feeVault.toBuffer().copy(data, 100);
      return data;
    };

    it('pays the fee vault the config names', () => {
      const feeVault = ix.readFeeVault(encryptConfigData(OTHER), PAYER);
      const instruction = ix.createDeposit(CONFIG, { payer: PAYER, feeVault });

      expect(instruction.programId).toEqual(ENCRYPT);
      expect(instruction.data).toEqual(
        Buffer.concat([Buffer.from([14, depositBump]), Buffer.alloc(16)])
      );
      expect(metasOf(instruction)).toEqual([
        meta(depositPda, W),
        meta(configPda, RO),
        meta(PAYER, S),
        meta(PAYER, SW),
        meta(PAYER, SW),
        meta(OTHER, W),
        meta(SYSTEM, RO),
        meta(SYSTEM, RO),
      ]);
    });

    it('uses the payer, as a signer, when the config fee vault is the System Program', () => {
      const feeVault = ix.readFeeVault(encryptConfigData(SYSTEM), PAYER);
      const instruction = ix.createDeposit(CONFIG, { payer: PAYER, feeVault });

      expect(feeVault).toEqual(PAYER);
      expect(metasOf(instruction)[5]).toEqual(meta(PAYER, SW));
    });
  });

  it('builds InitializeAccount with the fresh balance ciphertext and an owner that need not sign', () => {
    const [account, accountBump] = pcAccount(USDC.pcMint, OTHER);
    const instruction = ix.initializeAccount(CONFIG, {
      payer: PAYER,
      owner: OTHER,
      side: USDC,
      balanceCt: FRESH,
    });

    expect(instruction.programId).toEqual(PC_TOKEN);
    expect(instruction.data).toEqual(Buffer.from([1, accountBump, tokenCpiBump]));
    expect(metasOf(instruction)).toEqual([
      meta(account, W),
      meta(pk(USDC.pcMint), RO),
      meta(OTHER, RO),
      meta(FRESH, SW),
      ...tail(),
    ]);
  });

  it('builds Wrap with the fresh key as the amount ciphertext', () => {
    const instruction = ix.wrap(CONFIG, {
      payer: PAYER,
      side: USDC,
      balanceCt: CT_A,
      amountCt: FRESH,
      amount: 1000n,
    });

    expect(instruction.programId).toEqual(PC_TOKEN);
    expect(instruction.data).toEqual(Buffer.concat([Buffer.from([30, tokenCpiBump]), u64(1000n)]));
    expect(metasOf(instruction)).toEqual([
      meta(pk(USDC.vault), RO),
      meta(pcAccount(USDC.pcMint, PAYER)[0], RO),
      meta(getAssociatedTokenAddressSync(pk(USDC.splMint), PAYER), W),
      meta(pk(USDC.vaultAta), W),
      meta(CT_A, W),
      meta(FRESH, SW),
      ...tail(),
      meta(TOKEN_PROGRAM_ID, RO),
    ]);
  });

  it('builds ViewBalance with the fresh key as the copy and a viewer that does not sign', () => {
    const instruction = ix.viewBalance(CONFIG, {
      payer: PAYER,
      side: DOGE,
      balanceCt: CT_A,
      viewCt: FRESH,
      viewer: OTHER,
    });

    expect(instruction.data).toEqual(Buffer.from([40, tokenCpiBump]));
    expect(metasOf(instruction)).toEqual([
      meta(pcAccount(DOGE.pcMint, PAYER)[0], RO),
      meta(CT_A, RO),
      meta(FRESH, SW),
      meta(OTHER, RO),
      ...tail(),
    ]);
  });

  it('builds Transfer with the executor input and the sender as the only signer', () => {
    const instruction = ix.transfer(CONFIG, {
      payer: PAYER,
      to: OTHER,
      side: USDC,
      fromBalanceCt: CT_A,
      toBalanceCt: CT_B,
      amountCt: CT_C,
    });

    expect(instruction.data).toEqual(Buffer.from([3, tokenCpiBump]));
    expect(metasOf(instruction)).toEqual([
      meta(pcAccount(USDC.pcMint, PAYER)[0], RO),
      meta(pcAccount(USDC.pcMint, OTHER)[0], RO),
      meta(CT_A, W),
      meta(CT_B, W),
      meta(CT_C, W),
      ...tail(),
    ]);
    expect(instruction.keys.filter((k) => k.isSigner).map((k) => k.pubkey)).toEqual([PAYER]);
  });

  describe('Swap', () => {
    const pool = CONFIG.pool;
    const swapTail = [
      meta(ENCRYPT, RO),
      meta(configPda, W),
      meta(depositPda, W),
      meta(swapCpi, RO),
      meta(PC_SWAP, RO),
      meta(tokenCpi, RO),
      meta(PC_TOKEN, RO),
      meta(networkKey, RO),
      meta(PAYER, SW),
      meta(eventAuthority, RO),
      meta(SYSTEM, RO),
    ];
    const build = (sideIn, sideOut) =>
      ix.swap(CONFIG, {
        payer: PAYER,
        sideIn,
        sideOut,
        userInBalCt: CT_A,
        userOutBalCt: CT_B,
        amountInCt: key(0x11),
        minOutCt: key(0x12),
        amountOutCt: key(0x13),
        receiptCt: FRESH,
      });
    const inputs = [meta(key(0x11), W), meta(key(0x12), W), meta(key(0x13), W)];

    it('maps USDC → DOGE to direction 0 with the A accounts as input', () => {
      const instruction = build('USDC', 'DOGE');

      expect(instruction.programId).toEqual(PC_SWAP);
      expect(instruction.data).toEqual(Buffer.from([1, swapCpiBump, tokenCpiBump, 0]));
      expect(metasOf(instruction)).toEqual([
        meta(pk(pool.address), W),
        meta(pcAccount(USDC.pcMint, PAYER)[0], W),
        meta(pcAccount(DOGE.pcMint, PAYER)[0], W),
        meta(pk(pool.vaultAccountA), W),
        meta(pk(pool.vaultAccountB), W),
        meta(CT_A, W),
        meta(CT_B, W),
        meta(pk(pool.vaultBalanceCtA), W),
        meta(pk(pool.vaultBalanceCtB), W),
        meta(pk(pool.reserveCtA), W),
        meta(pk(pool.reserveCtB), W),
        ...inputs,
        meta(FRESH, SW),
        ...swapTail,
      ]);
    });

    it('maps DOGE → USDC to direction 1 with the B accounts as input', () => {
      const instruction = build('DOGE', 'USDC');

      expect(instruction.data).toEqual(Buffer.from([1, swapCpiBump, tokenCpiBump, 1]));
      expect(metasOf(instruction).slice(0, 11)).toEqual([
        meta(pk(pool.address), W),
        meta(pcAccount(DOGE.pcMint, PAYER)[0], W),
        meta(pcAccount(USDC.pcMint, PAYER)[0], W),
        meta(pk(pool.vaultAccountB), W),
        meta(pk(pool.vaultAccountA), W),
        meta(CT_A, W),
        meta(CT_B, W),
        meta(pk(pool.vaultBalanceCtB), W),
        meta(pk(pool.vaultBalanceCtA), W),
        meta(pk(pool.reserveCtB), W),
        meta(pk(pool.reserveCtA), W),
      ]);
    });

    it('names the reserves of each direction for the commit wait', () => {
      expect(ix.swapReserves(CONFIG, 'USDC')).toEqual([pk(pool.reserveCtA), pk(pool.reserveCtB)]);
      expect(ix.swapReserves(CONFIG, 'DOGE')).toEqual([pk(pool.reserveCtB), pk(pool.reserveCtA)]);
    });
  });

  it('builds UnwrapBurn with the fresh key as burnedCt seeding the receipt PDA', () => {
    const [receipt, receiptBump] = find([Buffer.from('pc_receipt'), FRESH.toBuffer()], PC_TOKEN);
    const instruction = ix.unwrapBurn(CONFIG, {
      payer: PAYER,
      side: USDC,
      balanceCt: CT_A,
      amountCt: CT_B,
      burnedCt: FRESH,
      amount: 250n,
    });

    expect(instruction.data).toEqual(
      Buffer.concat([Buffer.from([31, receiptBump, tokenCpiBump]), u64(250n)])
    );
    expect(metasOf(instruction)).toEqual([
      meta(pk(USDC.vault), RO),
      meta(pcAccount(USDC.pcMint, PAYER)[0], W),
      meta(receipt, W),
      meta(CT_A, W),
      meta(CT_B, W),
      meta(FRESH, SW),
      ...tail(),
    ]);
  });

  it('builds UnwrapDecrypt with the fresh request account and a read-only Encrypt config', () => {
    const instruction = ix.unwrapDecrypt(CONFIG, {
      payer: PAYER,
      receipt: CT_A,
      requestAcct: FRESH,
      burnedCt: CT_B,
    });

    expect(instruction.data).toEqual(Buffer.from([32, tokenCpiBump]));
    const expectedTail = tail();
    expectedTail[1] = meta(configPda, RO);
    expect(metasOf(instruction)).toEqual([
      meta(CT_A, W),
      meta(FRESH, SW),
      meta(CT_B, RO),
      ...expectedTail,
    ]);
  });

  it('builds UnwrapComplete signed by the owner alone, refunding the receipt rent to them', () => {
    const instruction = ix.unwrapComplete(CONFIG, {
      owner: PAYER,
      side: DOGE,
      receipt: CT_A,
      requestAcct: CT_B,
    });

    expect(instruction.data).toEqual(Buffer.from([33]));
    expect(metasOf(instruction)).toEqual([
      meta(CT_A, W),
      meta(pk(DOGE.vault), RO),
      meta(pk(DOGE.pcMint), RO),
      meta(CT_B, RO),
      meta(pk(DOGE.vaultAta), W),
      meta(getAssociatedTokenAddressSync(pk(DOGE.splMint), PAYER), W),
      meta(PAYER, S),
      meta(PAYER, W),
      meta(TOKEN_PROGRAM_ID, RO),
    ]);
  });

  describe('layout readers', () => {
    it('reads a 202-byte pc-account and rejects any other length', () => {
      const data = Buffer.alloc(202);
      CT_A.toBuffer().copy(data, 0);
      OTHER.toBuffer().copy(data, 32);
      CT_B.toBuffer().copy(data, 64);

      expect(ix.readPcAccount(data)).toEqual({ mint: CT_A, owner: OTHER, balanceCt: CT_B });
      expect(ix.readPcAccount(Buffer.alloc(201))).toBeNull();
      expect(ix.readPcAccount(Buffer.alloc(203))).toBeNull();
    });

    it('reads a ciphertext status and spots a never-committed digest', () => {
      const committed = Buffer.alloc(100);
      committed.fill(9, 2, 34);
      committed[99] = 1;
      const zero = Buffer.alloc(100);
      zero[99] = 1;
      const pending = Buffer.from(committed);
      pending[99] = 0;

      expect(ix.readCiphertextStatus(committed)).toEqual({
        digest: Buffer.alloc(32, 9),
        committed: true,
        neverCommitted: false,
      });
      expect(ix.readCiphertextStatus(zero)).toMatchObject({
        committed: true,
        neverCommitted: true,
      });
      expect(ix.readCiphertextStatus(pending)).toMatchObject({ committed: false });
      expect(ix.readCiphertextStatus(Buffer.alloc(99))).toBeNull();
    });

    it('reads a 203-byte withdrawal receipt and rejects any other length', () => {
      const data = Buffer.alloc(203);
      PAYER.toBuffer().copy(data, 0);
      data.writeBigUInt64LE(250n, 32);
      data[72] = 254;
      FRESH.toBuffer().copy(data, 73);
      pk(USDC.vault).toBuffer().copy(data, 105);
      pk(USDC.pcMint).toBuffer().copy(data, 137);
      CT_C.toBuffer().copy(data, 169);
      data[201] = 1;

      expect(ix.readReceipt(data)).toEqual({
        owner: PAYER,
        amount: 250n,
        burnedCt: FRESH,
        vault: pk(USDC.vault),
        pcMint: pk(USDC.pcMint),
        request: CT_C,
        decryptRequested: true,
      });
      expect(ix.readReceipt(Buffer.alloc(202))).toBeNull();
    });
  });
});
