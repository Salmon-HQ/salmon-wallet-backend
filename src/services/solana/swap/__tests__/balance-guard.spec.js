'use strict';

const { PublicKey, SystemProgram, TransactionInstruction } = require('@solana/web3.js');
const { AccountLayout, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const { readTakerAccounts, balanceMismatch } = require('../balance-guard');
const solToUsdc = require('./fixtures/jupiter-build-sol-usdc-fee.json');

// The fixture's request: 0.01 SOL → USDC for this taker, Salmon's fee in USDC.
const TAKER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const TAKER_WSOL = 'HXkHFMCRQP6pw66QEGBqVsduqUQdSyrrrq82S7Rffsms';
const TAKER_USDC = '9SHQTA66Ekh7ZgMnKWsjxXk6DwXku8przs45E8bcEe38';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const AMOUNT = '10000000';
const RENT = 2039280;
const FEES = 6400;

const toInstruction = (raw) =>
  new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys: raw.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(raw.data, 'base64'),
  });
const instructions = [
  ...solToUsdc.setupInstructions,
  solToUsdc.swapInstruction,
  solToUsdc.cleanupInstruction,
].map(toInstruction);

const usdcAccount = (amount) => {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint: new PublicKey(USDC),
      owner: new PublicKey(TAKER),
      amount: BigInt(amount),
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data
  );
  return {
    lamports: RENT,
    owner: TOKEN_PROGRAM_ID.toBase58(),
    data: [data.toString('base64'), 'base64'],
  };
};
const walletAfter = (lamports) => ({
  lamports,
  owner: SystemProgram.programId.toBase58(),
  data: ['', 'base64'],
});

describe('balance guard on a real Jupiter build (SOL → USDC, wrap, swap, unwrap)', () => {
  // Before the swap only the wallet exists: both of its token accounts are created here.
  const connection = {
    getMultipleAccountsInfoAndContext: jest.fn(async (keys) => ({
      context: { slot: 7 },
      value: keys.map((key) =>
        key.toBase58() === TAKER
          ? { lamports: 1000000000, owner: SystemProgram.programId, data: Buffer.alloc(0) }
          : null
      ),
    })),
  };

  const check = (watched, after) =>
    balanceMismatch({
      watched,
      after,
      taker: TAKER,
      inputMint: SOL,
      amount: AMOUNT,
      signatures: 1,
      priorityFeeMicroLamports: 1000,
      computeUnitLimit: 1400000,
    });

  it("watches the wallet and the two accounts the build creates for it, not Salmon's fee account", async () => {
    const watched = await readTakerAccounts(connection, TAKER, instructions);

    expect(watched.addresses).toEqual([TAKER, TAKER_WSOL, TAKER_USDC]);
    expect(watched.foreignCreates).toBe(0);
    expect(watched.minContextSlot).toBe(7);
  });

  it('passes the swap the build describes: 0.01 SOL and the fees out, USDC in', async () => {
    const watched = await readTakerAccounts(connection, TAKER, instructions);
    // The wrapped-SOL account is closed again, so it reports nothing after the run.
    const after = [walletAfter(1000000000 - 10000000 - RENT - FEES), null, usdcAccount(1173138)];

    expect(check(watched, after)).toBeNull();
  });

  it('refuses the same build when the wallet ends 0.001 SOL lower than the swap explains', async () => {
    const watched = await readTakerAccounts(connection, TAKER, instructions);
    const after = [
      walletAfter(1000000000 - 10000000 - RENT - FEES - 1000000),
      null,
      usdcAccount(1173138),
    ];

    expect(check(watched, after)).toBe(
      `taker loses ${10000000 + FEES + 1000000} lamports, more than ${10000000 + FEES}`
    );
  });
});
