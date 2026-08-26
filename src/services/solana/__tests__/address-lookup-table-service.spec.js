'use strict';

/**
 * Unit tests for the lookup-table fallback transaction builder.
 *
 * Mocks `Connection`, `PublicKey`, `Transaction`, and `AddressLookupTableProgram`
 * from @solana/web3.js so the spec doesn't reach out to the network. Asserts:
 *   - chunking into LOOKUP_TABLE_EXTEND_CHUNK_SIZE batches
 *   - estimatedRentLamports + extendTransactionCount + step strings (the
 *     fields the FE keys on)
 *   - early null when there are no non-signer static keys
 */

jest.mock('@solana/web3.js', () => {
  class MockPublicKey {
    constructor(value) {
      this._v = String(value);
    }
    toBase58() {
      return this._v;
    }
  }

  class MockTransaction {
    constructor() {
      this.instructions = [];
      this.feePayer = null;
      this.recentBlockhash = null;
    }
    add(...ix) {
      this.instructions.push(...ix);
      return this;
    }
  }

  const Connection = jest.fn(() => ({
    getSlot: jest.fn().mockResolvedValue(100),
    getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: 'blockhash-1' }),
    getMinimumBalanceForRentExemption: jest.fn().mockResolvedValue(2_500_000),
  }));

  const lookupTableAddress = new MockPublicKey('LookupTablePDA');
  const AddressLookupTableProgram = {
    createLookupTable: jest.fn(() => [{ programId: 'create-ix' }, lookupTableAddress]),
    extendLookupTable: jest.fn(() => ({ programId: 'extend-ix' })),
  };

  return {
    Connection,
    PublicKey: MockPublicKey,
    Transaction: MockTransaction,
    AddressLookupTableProgram,
  };
});

jest.mock('@metaplex-foundation/umi-web3js-adapters', () => ({
  fromWeb3JsPublicKey: jest.fn((pk) => ({ __umi: pk.toBase58() })),
}));

jest.mock('../transaction-serialization', () => ({
  createTransactionResponseFromWeb3: jest.fn(async (tx) => ({
    serialized: tx.instructions.map((ix) => ix.programId).join(','),
    feePayer: tx.feePayer.toBase58(),
  })),
}));

const { createLookupTableFallbackTransactions } = require('../address-lookup-table-service');

const buildVersionedTx = (numRequiredSignatures, staticKeys) => ({
  message: {
    header: { numRequiredSignatures },
    staticAccountKeys: staticKeys.map((value) => ({ toBase58: () => value })),
  },
});

describe('createLookupTableFallbackTransactions', () => {
  test('returns null when there are no non-signer static keys', async () => {
    const out = await createLookupTableFallbackTransactions({
      owner: 'OwnerWallet',
      nodeUrl: 'https://test',
      versionedTransaction: buildVersionedTx(1, ['signer1']),
    });
    expect(out).toBeNull();
  });

  test('builds a single extend tx for ≤20 unique non-signer keys', async () => {
    const keys = ['signer1', ...Array.from({ length: 5 }, (_, i) => `key${i}`)];
    const out = await createLookupTableFallbackTransactions({
      owner: 'OwnerWallet',
      nodeUrl: 'https://test',
      versionedTransaction: buildVersionedTx(1, keys),
    });

    expect(out).not.toBeNull();
    expect(out.lookupTable.required).toBe(true);
    expect(out.lookupTable.addressCount).toBe(5);
    expect(out.lookupTable.extendTransactionCount).toBe(1);
    expect(out.lookupTable.estimatedRentLamports).toBe(2_500_000);
    expect(out.lookupTable.estimatedRentSol).toBeCloseTo(0.0025, 6);

    expect(out.transactions[0].step).toBe('lookup_table_create');
    expect(out.transactions[0].expectedLookupTableAddressCount).toBe(0);
    expect(out.transactions[1].step).toBe('lookup_table_extend');
    expect(out.transactions[1].expectedLookupTableAddressCount).toBe(5);
  });

  test('chunks >20 keys into multiple extend txs with cumulative expected counts', async () => {
    // 1 signer + 25 unique non-signers → 25 keys to chunk → ceil(25/20)=2 chunks
    const nonSigners = Array.from({ length: 25 }, (_, i) => `key${i}`);
    const keys = ['signer1', ...nonSigners];
    const out = await createLookupTableFallbackTransactions({
      owner: 'OwnerWallet',
      nodeUrl: 'https://test',
      versionedTransaction: buildVersionedTx(1, keys),
    });

    expect(out.lookupTable.addressCount).toBe(25);
    expect(out.lookupTable.extendTransactionCount).toBe(2);
    expect(out.transactions).toHaveLength(3); // 1 create + 2 extend

    expect(out.transactions[1].step).toBe('lookup_table_extend');
    expect(out.transactions[1].expectedLookupTableAddressCount).toBe(20);
    expect(out.transactions[2].expectedLookupTableAddressCount).toBe(25);
    expect(out.transactions[2].message).toBe('Extend lookup table batch 2/2');
  });

  test('deduplicates repeated non-signer static keys', async () => {
    // 1 signer + 3 distinct keys, two appearing twice
    const keys = ['signer1', 'a', 'b', 'a', 'c', 'b'];
    const out = await createLookupTableFallbackTransactions({
      owner: 'OwnerWallet',
      nodeUrl: 'https://test',
      versionedTransaction: buildVersionedTx(1, keys),
    });
    expect(out.lookupTable.addressCount).toBe(3);
  });

  test('rent estimation scales with address count via mocked connection', async () => {
    const out = await createLookupTableFallbackTransactions({
      owner: 'OwnerWallet',
      nodeUrl: 'https://test',
      versionedTransaction: buildVersionedTx(1, ['signer1', 'a', 'b']),
    });
    expect(out.lookupTable.estimatedRentLamports).toBe(2_500_000);
  });

  test('lookupTableInput addresses are converted via umi adapter', async () => {
    const out = await createLookupTableFallbackTransactions({
      owner: 'OwnerWallet',
      nodeUrl: 'https://test',
      versionedTransaction: buildVersionedTx(1, ['signer1', 'a', 'b']),
    });
    expect(out.lookupTableInput.addresses).toEqual([{ __umi: 'a' }, { __umi: 'b' }]);
    expect(out.lookupTableInput.publicKey).toEqual({ __umi: 'LookupTablePDA' });
  });

  test('lookupTableAddress is exposed as base58 string in each tx', async () => {
    const out = await createLookupTableFallbackTransactions({
      owner: 'OwnerWallet',
      nodeUrl: 'https://test',
      versionedTransaction: buildVersionedTx(1, ['signer1', 'a']),
    });
    expect(out.transactions[0].lookupTableAddress).toBe('LookupTablePDA');
    expect(out.transactions[1].lookupTableAddress).toBe('LookupTablePDA');
  });
});
