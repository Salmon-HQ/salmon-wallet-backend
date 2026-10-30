'use strict';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../dagon/config', () => ({
  ...jest.requireActual('../dagon/config'),
  getConfig: jest.fn(),
}));
jest.mock('../dagon/executor', () => ({ createInputs: jest.fn(), waitCommitted: jest.fn() }));

const axios = require('axios');
const { PublicKey, SystemProgram } = require('@solana/web3.js');
const dagon = require('../dagon');
const { getConfig } = require('../dagon/config');
const executor = require('../dagon/executor');
const ix = require('../dagon/instructions');
const CONFIG = require('./fixtures/dagon-devnet-epoch2.json');

const PAYER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const FRESH = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
const FRESH_2 = 'SysvarRent111111111111111111111111111111111';
const OTHER = 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m';
const OTHER_2 = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const QUERIES = {
  setup: { side: 'USDC', freshSigners: FRESH },
  wrap: { side: 'USDC', amount: '1000', freshSigners: FRESH },
  reveal: { side: 'USDC', viewer: OTHER, freshSigners: FRESH },
  send: { side: 'USDC', amount: '1000', to: OTHER, freshSigners: '' },
  swap: {
    sideIn: 'USDC',
    sideOut: 'DOGE',
    amountIn: '100',
    minAmountOut: '90',
    freshSigners: FRESH,
  },
  unwrapBurn: { side: 'USDC', amount: '250', freshSigners: FRESH },
  unwrapDecrypt: { burnedCt: OTHER, freshSigners: FRESH },
  unwrapComplete: { burnedCt: OTHER, requestAcct: OTHER_2, freshSigners: '' },
};
const query = (action, extra = {}) => ({ publicKey: PAYER, action, ...QUERIES[action], ...extra });
const without = (action, field) => {
  const q = query(action);
  delete q[field];
  return q;
};

describe('dagon adapter validate', () => {
  const expectError = (q, error) =>
    expect(dagon.validate(q)).toEqual({ error, error_description: expect.any(String) });

  it.each(Object.keys(QUERIES))('accepts a complete %s request without any I/O', (action) => {
    const result = dagon.validate(query(action));

    expect(result.params).toMatchObject({ action, publicKey: PAYER });
    expect(result.params.freshSigners).toEqual(dagon.FRESH_SIGNERS[action] ? [FRESH] : []);
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('declares one fresh key for every action but send and unwrapComplete', () => {
    expect(dagon.FRESH_SIGNERS).toEqual({
      setup: 1,
      wrap: 1,
      reveal: 1,
      send: 0,
      swap: 1,
      unwrapBurn: 1,
      unwrapDecrypt: 1,
      unwrapComplete: 0,
    });
  });

  it('parses amounts as BigInt and defaults the setup owner to the caller', () => {
    expect(dagon.validate(query('wrap')).params.amount).toBe(1000n);
    expect(dagon.validate(query('swap')).params).toMatchObject({
      amountIn: 100n,
      minAmountOut: 90n,
      sideIn: 'USDC',
      sideOut: 'DOGE',
    });
    expect(dagon.validate(query('setup')).params.owner).toBe(PAYER);
    expect(dagon.validate(query('setup', { owner: OTHER })).params.owner).toBe(OTHER);
  });

  it('answers missing_parameter without an action and invalid_parameter for an unknown one', () => {
    expectError({ publicKey: PAYER, freshSigners: FRESH }, 'missing_parameter');
    expectError({ publicKey: PAYER, action: 'mint', freshSigners: FRESH }, 'invalid_parameter');
    expectError(
      { publicKey: PAYER, action: '__proto__', freshSigners: FRESH },
      'invalid_parameter'
    );
  });

  it.each([
    ['setup', 'side'],
    ['setup', 'freshSigners'],
    ['wrap', 'side'],
    ['wrap', 'amount'],
    ['reveal', 'viewer'],
    ['send', 'to'],
    ['send', 'amount'],
    ['send', 'freshSigners'],
    ['swap', 'sideIn'],
    ['swap', 'sideOut'],
    ['swap', 'amountIn'],
    ['swap', 'minAmountOut'],
    ['unwrapBurn', 'amount'],
    ['unwrapDecrypt', 'burnedCt'],
    ['unwrapComplete', 'burnedCt'],
    ['unwrapComplete', 'requestAcct'],
  ])('%s without %s → missing_parameter', (action, field) => {
    expectError(without(action, field), 'missing_parameter');
    expectError(
      query(action, { [field]: field === 'freshSigners' ? undefined : '' }),
      'missing_parameter'
    );
  });

  it.each([
    ['0', 'amount'],
    ['-5', 'amount'],
    ['1.5', 'amount'],
    ['1e3', 'amount'],
    [' 10', 'amount'],
    ['18446744073709551616', 'amount'],
  ])('refuses amount %s with invalid_parameter', (value) => {
    expectError(query('wrap', { amount: value }), 'invalid_parameter');
    expectError(query('swap', { amountIn: value }), 'invalid_parameter');
  });

  it('accepts the largest u64 amount', () => {
    expect(dagon.validate(query('wrap', { amount: '18446744073709551615' })).params.amount).toBe(
      18446744073709551615n
    );
  });

  it('refuses minAmountOut = 0', () => {
    expectError(query('swap', { minAmountOut: '0' }), 'invalid_parameter');
  });

  it('refuses a viewer or recipient that is the caller', () => {
    expectError(query('reveal', { viewer: PAYER }), 'invalid_parameter');
    expectError(query('send', { to: PAYER }), 'invalid_parameter');
  });

  it.each([
    ['setup', 'owner'],
    ['reveal', 'viewer'],
    ['send', 'to'],
    ['unwrapDecrypt', 'burnedCt'],
    ['unwrapComplete', 'requestAcct'],
  ])('%s refuses an invalid base58 %s', (action, field) => {
    expectError(query(action, { [field]: 'not-a-key!' }), 'invalid_parameter');
  });

  it('refuses a repeated or non-string parameter', () => {
    expectError(query('wrap', { amount: ['1', '2'] }), 'invalid_parameter');
    expectError(query('wrap', { side: { a: 1 } }), 'invalid_parameter');
  });

  it.each([
    ['repeated in the query', 'wrap', [FRESH, FRESH_2]],
    ['with an empty entry', 'wrap', `${FRESH},`],
    ['with an invalid key', 'wrap', 'nope!'],
    ['duplicated', 'setup', `${FRESH},${FRESH}`],
    ['one too many', 'wrap', `${FRESH},${FRESH_2}`],
    ['missing on an action that declares one', 'wrap', ''],
    ['supplied on an action that declares none', 'send', FRESH],
    ['equal to the caller', 'wrap', PAYER],
    ['equal to the viewer', 'reveal', OTHER],
    ['equal to the recipient', 'send', OTHER],
    ['equal to the setup owner', 'setup', OTHER],
    ['equal to burnedCt', 'unwrapDecrypt', OTHER],
  ])('answers invalid_fresh_signers for fresh keys %s', (_label, action, freshSigners) => {
    const extra = { freshSigners };
    if (action === 'setup' && freshSigners === OTHER) extra.owner = OTHER;
    expectError(query(action, extra), 'invalid_fresh_signers');
  });

  it('refuses a fresh key equal to requestAcct', () => {
    const q = query('unwrapComplete', { freshSigners: OTHER_2 });
    expectError(q, 'invalid_fresh_signers');
  });

  it('reads freshSigners= as no fresh key for send and unwrapComplete', () => {
    expect(dagon.validate(query('send')).params.freshSigners).toEqual([]);
    expect(dagon.validate(query('unwrapComplete')).params.freshSigners).toEqual([]);
  });

  it.each([
    'secretKey',
    'privateKey',
    'seed',
    'mnemonic',
    'keypair',
    'signedTransaction',
    'SEED_PHRASE',
  ])('refuses a %s field with invalid_parameter (FR-008)', (field) => {
    expectError(query('wrap', { [field]: 'x' }), 'invalid_parameter');
  });

  it('never echoes a caller value in the error description', () => {
    const secret = 'marker-value-4f1c9e';
    const result = dagon.validate(query('wrap', { secretKey: secret }));

    expect(result.error_description).not.toContain(secret);
  });

  it('ignores unknown extra keys', () => {
    expect(dagon.validate(query('wrap', { utm_source: 'x' })).params).not.toHaveProperty(
      'utm_source'
    );
  });
});

describe('dagon adapter build', () => {
  const ENCRYPT = CONFIG.programs.encrypt;
  const PC_TOKEN = CONFIG.programs.pcToken;
  const PC_SWAP = CONFIG.programs.pcSwap;
  const USDC = CONFIG.sides.USDC;
  const DOGE = CONFIG.sides.DOGE;
  const locals = { network: { id: 'solana-devnet' }, deadline: Date.now() + 25000 };
  const key = (byte) => new PublicKey(Buffer.alloc(32, byte));
  const BAL_IN = key(0xa1);
  const BAL_OUT = key(0xa2);
  const BAL_TO = key(0xa3);
  const pcAccountOf = (side, owner) =>
    ix.pda.pcAccount(new PublicKey(side.pcMint), new PublicKey(owner))[0];

  const pcAccountData = (side, owner, balanceCt) => {
    const data = Buffer.alloc(202);
    new PublicKey(side.pcMint).toBuffer().copy(data, 0);
    new PublicKey(owner).toBuffer().copy(data, 32);
    balanceCt.toBuffer().copy(data, 64);
    return { data, owner: new PublicKey(PC_TOKEN) };
  };
  const ciphertextData = (status, digestByte = 9) => {
    const data = Buffer.alloc(100);
    data.fill(digestByte, 2, 34);
    data[99] = status;
    return { data, owner: new PublicKey(ENCRYPT) };
  };
  const encryptConfigData = () => {
    const data = Buffer.alloc(133);
    key(0xee).toBuffer().copy(data, 100);
    return { data, owner: new PublicKey(ENCRYPT) };
  };

  let chain;
  const connection = { getMultipleAccountsInfo: jest.fn() };
  const put = (address, info) => chain.set(address.toString(), info);
  const run = (action, extra) => {
    const { params } = dagon.validate(query(action, extra));
    return dagon.build(params, { locals, connection });
  };
  // Order is the compiler's job (payer first); here only the set matters.
  const signersOf = (instructions) =>
    [
      ...new Set(
        instructions.flatMap((i) =>
          i.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())
        )
      ),
    ].sort();
  const sorted = (...keys) => [...keys].sort();
  const kindsOf = (instructions) => instructions.map((i) => [i.programId.toBase58(), i.data[0]]);
  const rejects = (promise, statusCode, errorCode) =>
    expect(promise).rejects.toMatchObject({ statusCode, errorCode });

  beforeEach(() => {
    jest.clearAllMocks();
    chain = new Map();
    getConfig.mockResolvedValue(CONFIG);
    connection.getMultipleAccountsInfo.mockImplementation(async (keys) =>
      keys.map((k) => chain.get(k.toBase58()) ?? null)
    );
    put(ix.pda.encryptConfig()[0], encryptConfigData());
  });

  const withDeposit = () =>
    put(ix.pda.encryptDeposit(new PublicKey(PAYER))[0], { data: Buffer.alloc(8) });
  const withPcAccount = (side, owner, balanceCt) =>
    put(pcAccountOf(side, owner), pcAccountData(side, owner, balanceCt));

  describe('setup, wrap, reveal (US1)', () => {
    it('setup without a deposit creates it, then the pc-account', async () => {
      const result = await run('setup');

      expect(getConfig).toHaveBeenCalledWith(locals);
      expect(kindsOf(result.instructions)).toEqual([
        [ENCRYPT, 14],
        [PC_TOKEN, 1],
      ]);
      expect(signersOf(result.instructions)).toEqual(sorted(PAYER, FRESH));
      expect(result.instructions[1].keys[0].pubkey).toEqual(pcAccountOf(USDC, PAYER));
      expect(executor.createInputs).not.toHaveBeenCalled();
    });

    it('setup with a deposit initializes the pc-account only', async () => {
      withDeposit();

      const result = await run('setup');

      expect(kindsOf(result.instructions)).toEqual([[PC_TOKEN, 1]]);
    });

    it('setup for another owner opens their pc-account, paid and signed by the caller', async () => {
      withDeposit();

      const result = await run('setup', { owner: OTHER });

      const [init] = result.instructions;
      expect(init.keys[0].pubkey).toEqual(pcAccountOf(USDC, OTHER));
      expect(init.keys[2]).toMatchObject({ pubkey: new PublicKey(OTHER), isSigner: false });
      expect(signersOf(result.instructions)).toEqual(sorted(PAYER, FRESH));
      expect(result.display).toMatchObject({ owner: OTHER });
    });

    it('setup answers 409 already_initialized when the pc-account exists', async () => {
      withPcAccount(USDC, PAYER, BAL_IN);

      await rejects(run('setup'), 409, 'already_initialized');
    });

    it('wrap names the fresh key as the amount ciphertext and calls no executor', async () => {
      withPcAccount(USDC, PAYER, BAL_IN);

      const result = await run('wrap');

      expect(kindsOf(result.instructions)).toEqual([[PC_TOKEN, 30]]);
      expect(result.instructions[0].keys[4].pubkey).toEqual(BAL_IN);
      expect(result.instructions[0].keys[5]).toMatchObject({
        pubkey: new PublicKey(FRESH),
        isSigner: true,
      });
      expect(signersOf(result.instructions)).toEqual(sorted(PAYER, FRESH));
      expect(executor.createInputs).not.toHaveBeenCalled();
    });

    it('reveal copies the balance to the fresh key for a viewer that does not sign, reading no ciphertext', async () => {
      withPcAccount(USDC, PAYER, BAL_IN);

      const result = await run('reveal');

      const [view] = result.instructions;
      expect(kindsOf(result.instructions)).toEqual([[PC_TOKEN, 40]]);
      expect(view.keys[2]).toMatchObject({ pubkey: new PublicKey(FRESH), isSigner: true });
      expect(view.keys[3]).toMatchObject({ pubkey: new PublicKey(OTHER), isSigner: false });
      const read = connection.getMultipleAccountsInfo.mock.calls.flatMap(([keys]) =>
        keys.map((k) => k.toBase58())
      );
      expect(read).not.toContain(BAL_IN.toBase58());
    });

    it.each(['wrap', 'reveal'])(
      '%s without a pc-account answers 409 setup_required',
      async (action) => {
        await rejects(run(action), 409, 'setup_required');
      }
    );

    it('answers 400 invalid_parameter for a side the config does not name', async () => {
      await rejects(run('wrap', { side: 'SOL' }), 400, 'invalid_parameter');
      await rejects(run('wrap', { side: '__proto__' }), 400, 'invalid_parameter');
    });

    it('answers 400 invalid_fresh_signers when the fresh key already exists on chain', async () => {
      withPcAccount(USDC, PAYER, BAL_IN);
      put(FRESH, { data: Buffer.alloc(0), owner: SystemProgram.programId });

      await rejects(run('wrap'), 400, 'invalid_fresh_signers');
      expect(executor.createInputs).not.toHaveBeenCalled();
    });

    it('describes the request, never an outcome, and names Dagon as the provider', async () => {
      withPcAccount(USDC, PAYER, BAL_IN);

      const result = await run('wrap');

      expect(result.provider).toEqual({
        id: 'dagon',
        displayName: 'Dagon (devnet preview)',
        attribution: null,
      });
      expect(result.display).toEqual({
        action: 'wrap',
        side: 'USDC',
        amount: '1000',
        decimals: 2,
        outcomeKnownAfterReveal: true,
      });
      expect(JSON.stringify(result.display)).not.toMatch(
        /success|received|expected|quote|outcome"/i
      );
    });
  });

  describe('swap (US2)', () => {
    const INPUTS = [key(0x11), key(0x12), key(0x13)];
    const pool = CONFIG.pool;
    const ready = () => {
      put(pool.address, { data: Buffer.alloc(226), owner: new PublicKey(PC_SWAP) });
      withPcAccount(USDC, PAYER, BAL_IN);
      withPcAccount(DOGE, PAYER, BAL_OUT);
      put(BAL_IN, ciphertextData(1));
      executor.createInputs.mockResolvedValue(INPUTS);
      executor.waitCommitted.mockResolvedValue();
    };

    it('USDC → DOGE: direction 0, three pc-swap inputs waited with both reserves, fresh receipt', async () => {
      ready();

      const result = await run('swap');

      expect(executor.createInputs).toHaveBeenCalledWith([100n, 90n, 0n], PC_SWAP, CONFIG, locals);
      expect(executor.waitCommitted).toHaveBeenCalledWith(
        connection,
        INPUTS,
        [new PublicKey(pool.reserveCtA), new PublicKey(pool.reserveCtB)],
        locals
      );
      expect(kindsOf(result.instructions)).toEqual([[PC_SWAP, 1]]);
      const [swap] = result.instructions;
      expect(swap.data[3]).toBe(0);
      expect(swap.keys[1].pubkey).toEqual(pcAccountOf(USDC, PAYER));
      expect(swap.keys[5].pubkey).toEqual(BAL_IN);
      expect(swap.keys[6].pubkey).toEqual(BAL_OUT);
      expect(swap.keys.slice(11, 14).map((k) => k.pubkey)).toEqual(INPUTS);
      expect(swap.keys[14]).toMatchObject({ pubkey: new PublicKey(FRESH), isSigner: true });
      expect(signersOf(result.instructions)).toEqual(sorted(PAYER, FRESH));
      expect(result.display).toEqual({
        action: 'swap',
        sideIn: 'USDC',
        sideOut: 'DOGE',
        amountIn: '100',
        minAmountOut: '90',
        decimals: 2,
        outcomeKnownAfterReveal: true,
      });
    });

    it('DOGE → USDC: direction 1 with the B side as input', async () => {
      ready();
      put(BAL_OUT, ciphertextData(1));

      const result = await run('swap', { sideIn: 'DOGE', sideOut: 'USDC' });

      expect(result.instructions[0].data[3]).toBe(1);
      expect(result.instructions[0].keys[1].pubkey).toEqual(pcAccountOf(DOGE, PAYER));
      expect(executor.waitCommitted.mock.calls[0][2]).toEqual([
        new PublicKey(pool.reserveCtB),
        new PublicKey(pool.reserveCtA),
      ]);
    });

    it('never prepends a deposit or an account setup', async () => {
      ready();

      const result = await run('swap');

      expect(result.instructions).toHaveLength(1);
    });

    it.each([
      ['pending', ciphertextData(0)],
      ['never committed', ciphertextData(1, 0)],
      ['missing', null],
    ])(
      'answers 409 balance_settling when the input balance is %s, before any executor call',
      async (_label, info) => {
        ready();
        put(BAL_IN, info);

        await rejects(run('swap'), 409, 'balance_settling');
        expect(executor.createInputs).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['input', USDC],
      ['output', DOGE],
    ])('answers 409 setup_required when the %s pc-account is missing', async (_label, side) => {
      ready();
      chain.delete(pcAccountOf(side, PAYER).toBase58());

      await rejects(run('swap'), 409, 'setup_required');
      expect(executor.createInputs).not.toHaveBeenCalled();
    });

    it('answers 503 pool_unavailable when the pool account is missing', async () => {
      ready();
      chain.delete(pool.address);

      await rejects(run('swap'), 503, 'pool_unavailable');
    });

    it('answers 400 invalid_fresh_signers when the receipt key already exists', async () => {
      ready();
      put(FRESH, { data: Buffer.alloc(0), owner: SystemProgram.programId });

      await rejects(run('swap'), 400, 'invalid_fresh_signers');
      expect(executor.createInputs).not.toHaveBeenCalled();
    });

    it.each([
      ['pool_unavailable', 'a reserve still pending'],
      ['executor_pending', 'inputs still pending'],
    ])('passes 503 %s through (%s)', async (code) => {
      ready();
      executor.waitCommitted.mockRejectedValue(
        Object.assign(new Error(code), { statusCode: 503, errorCode: code })
      );

      await rejects(run('swap'), 503, code);
    });

    it('passes 503 executor_unavailable through', async () => {
      ready();
      executor.createInputs.mockRejectedValue(
        Object.assign(new Error('down'), { statusCode: 503, errorCode: 'executor_unavailable' })
      );

      await rejects(run('swap'), 503, 'executor_unavailable');
      expect(executor.waitCommitted).not.toHaveBeenCalled();
    });

    it.each([
      ['the same side in and out', { sideOut: 'USDC' }],
      ['a side the pool does not hold', { sideIn: 'SOL' }],
    ])('answers 400 invalid_parameter for %s', async (_label, extra) => {
      ready();

      await rejects(run('swap', extra), 400, 'invalid_parameter');
      expect(executor.createInputs).not.toHaveBeenCalled();
    });
  });

  describe('send (US3)', () => {
    const AMOUNT_CT = key(0x21);
    const ready = () => {
      withPcAccount(USDC, PAYER, BAL_IN);
      withPcAccount(USDC, OTHER, BAL_TO);
      put(BAL_IN, ciphertextData(1));
      executor.createInputs.mockResolvedValue([AMOUNT_CT]);
      executor.waitCommitted.mockResolvedValue();
    };

    it('builds a Transfer from one pc-token input, signed by the sender alone', async () => {
      ready();

      const result = await run('send');

      expect(executor.createInputs).toHaveBeenCalledWith([1000n], PC_TOKEN, CONFIG, locals);
      expect(executor.waitCommitted).toHaveBeenCalledWith(connection, [AMOUNT_CT], [], locals);
      expect(kindsOf(result.instructions)).toEqual([[PC_TOKEN, 3]]);
      const [transfer] = result.instructions;
      expect(transfer.keys.slice(0, 5).map((k) => k.pubkey)).toEqual([
        pcAccountOf(USDC, PAYER),
        pcAccountOf(USDC, OTHER),
        BAL_IN,
        BAL_TO,
        AMOUNT_CT,
      ]);
      expect(signersOf(result.instructions)).toEqual([PAYER]);
      expect(result.display).toEqual({
        action: 'send',
        side: 'USDC',
        amount: '1000',
        recipient: OTHER,
        decimals: 2,
        outcomeKnownAfterReveal: true,
      });
    });

    it('answers 409 recipient_setup_required without onboarding the recipient', async () => {
      ready();
      chain.delete(pcAccountOf(USDC, OTHER).toBase58());

      await rejects(run('send'), 409, 'recipient_setup_required');
      expect(executor.createInputs).not.toHaveBeenCalled();
    });

    it('answers 409 setup_required when the sender has no pc-account', async () => {
      ready();
      chain.delete(pcAccountOf(USDC, PAYER).toBase58());

      await rejects(run('send'), 409, 'setup_required');
    });

    it.each([
      ['pending', ciphertextData(0)],
      ['never committed', ciphertextData(1, 0)],
    ])(
      'answers 409 balance_settling when the sender balance is %s, before any executor call',
      async (_label, info) => {
        ready();
        put(BAL_IN, info);

        await rejects(run('send'), 409, 'balance_settling');
        expect(executor.createInputs).not.toHaveBeenCalled();
      }
    );
  });

  describe('unwrap (US4)', () => {
    const AMOUNT_CT = key(0x31);
    const BURNED = new PublicKey(OTHER);
    const REQUEST = new PublicKey(OTHER_2);
    const receiptPda = (burnedCt) => ix.pda.receipt(burnedCt)[0];
    const receiptData = ({
      owner = PAYER,
      side = DOGE,
      request = REQUEST,
      requested = 0,
      length = 203,
    } = {}) => {
      const data = Buffer.alloc(length);
      if (length >= 203) {
        new PublicKey(owner).toBuffer().copy(data, 0);
        data.writeBigUInt64LE(250n, 32);
        BURNED.toBuffer().copy(data, 73);
        new PublicKey(side.vault).toBuffer().copy(data, 105);
        new PublicKey(side.pcMint).toBuffer().copy(data, 137);
        request.toBuffer().copy(data, 169);
        data[201] = requested;
      }
      return { data, owner: new PublicKey(PC_TOKEN) };
    };

    describe('unwrapBurn', () => {
      it('burns one waited pc-token input into the fresh burnedCt and its receipt PDA', async () => {
        withPcAccount(USDC, PAYER, BAL_IN);
        executor.createInputs.mockResolvedValue([AMOUNT_CT]);

        const result = await run('unwrapBurn');

        expect(executor.createInputs).toHaveBeenCalledWith([250n], PC_TOKEN, CONFIG, locals);
        expect(executor.waitCommitted).toHaveBeenCalledWith(connection, [AMOUNT_CT], [], locals);
        expect(kindsOf(result.instructions)).toEqual([[PC_TOKEN, 31]]);
        const [burn] = result.instructions;
        expect(burn.keys[2].pubkey).toEqual(receiptPda(new PublicKey(FRESH)));
        expect(burn.keys[3].pubkey).toEqual(BAL_IN);
        expect(burn.keys[4].pubkey).toEqual(AMOUNT_CT);
        expect(burn.keys[5]).toMatchObject({ pubkey: new PublicKey(FRESH), isSigner: true });
        expect(signersOf(result.instructions)).toEqual(sorted(PAYER, FRESH));
        expect(result.display).toMatchObject({ action: 'unwrapBurn', side: 'USDC', amount: '250' });
      });

      it('answers 409 setup_required without a pc-account', async () => {
        await rejects(run('unwrapBurn'), 409, 'setup_required');
        expect(executor.createInputs).not.toHaveBeenCalled();
      });
    });

    describe('unwrapDecrypt', () => {
      it('requests the decryption into the fresh request account', async () => {
        put(receiptPda(BURNED), receiptData());
        put(BURNED, ciphertextData(1));

        const result = await run('unwrapDecrypt');

        expect(kindsOf(result.instructions)).toEqual([[PC_TOKEN, 32]]);
        const [decrypt] = result.instructions;
        expect(decrypt.keys[0].pubkey).toEqual(receiptPda(BURNED));
        expect(decrypt.keys[1]).toMatchObject({ pubkey: new PublicKey(FRESH), isSigner: true });
        expect(decrypt.keys[2]).toMatchObject({ pubkey: BURNED, isSigner: false });
        expect(signersOf(result.instructions)).toEqual(sorted(PAYER, FRESH));
        expect(result.display).toMatchObject({ action: 'unwrapDecrypt', side: 'DOGE' });
        expect(executor.createInputs).not.toHaveBeenCalled();
      });

      it('answers 409 already_requested when the decryption was already asked for', async () => {
        put(receiptPda(BURNED), receiptData({ requested: 1 }));
        put(BURNED, ciphertextData(1));

        await rejects(run('unwrapDecrypt'), 409, 'already_requested');
      });

      it('answers 409 balance_settling while burnedCt is pending', async () => {
        put(receiptPda(BURNED), receiptData());
        put(BURNED, ciphertextData(0));

        await rejects(run('unwrapDecrypt'), 409, 'balance_settling');
      });
    });

    describe('unwrapComplete', () => {
      it('releases the SPL to the caller, the only signer, on the side the receipt names', async () => {
        put(receiptPda(BURNED), receiptData({ side: DOGE }));

        const result = await run('unwrapComplete');

        expect(kindsOf(result.instructions)).toEqual([[PC_TOKEN, 33]]);
        const [complete] = result.instructions;
        expect(complete.keys.slice(0, 4).map((k) => k.pubkey)).toEqual([
          receiptPda(BURNED),
          new PublicKey(DOGE.vault),
          new PublicKey(DOGE.pcMint),
          REQUEST,
        ]);
        expect(signersOf(result.instructions)).toEqual([PAYER]);
        expect(result.display).toEqual({
          action: 'unwrapComplete',
          side: 'DOGE',
          decimals: 2,
          outcomeKnownAfterReveal: true,
        });
      });

      it('answers 400 invalid_parameter when requestAcct is not the receipt request', async () => {
        put(receiptPda(BURNED), receiptData({ request: key(0x44) }));

        await rejects(run('unwrapComplete'), 400, 'invalid_parameter');
      });
    });

    describe.each(['unwrapDecrypt', 'unwrapComplete'])('%s receipt checks', (action) => {
      it.each([
        ['missing', () => null],
        ['not 203 bytes', () => receiptData({ length: 202 })],
        ['owned by another wallet', () => receiptData({ owner: OTHER_2 })],
      ])('answers 409 receipt_not_found when the receipt is %s', async (_label, receipt) => {
        put(receiptPda(BURNED), receipt());
        put(BURNED, ciphertextData(1));

        await rejects(run(action), 409, 'receipt_not_found');
      });
    });
  });
});
