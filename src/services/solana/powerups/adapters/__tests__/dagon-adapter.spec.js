'use strict';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

const axios = require('axios');
const dagon = require('../dagon');

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
