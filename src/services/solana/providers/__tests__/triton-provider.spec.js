'use strict';

/**
 * TritonProvider.getEnhancedTransactionHistory unit tests.
 *
 * Focus: the first-page vs paginated routing introduced with Superbank's
 * single-call `getTransactionsForAddress`.
 *
 *   - First page (no `before` cursor) → ONE `getTransactionsForAddress` call.
 *     No `getSignaturesForAddress` / `getParsedTransactionsBatch` round-trips.
 *   - Deeper pages (`before` present) → the legacy signature-cursor path, so
 *     `nextPageToken` stays a signature (Helius / bare-RPC fallback compatible).
 *
 * `triton-rpc` and the parser are mocked so the routing is asserted without
 * touching the network.
 */

jest.mock('../../parser/triton-rpc');
jest.mock('../../parser', () => ({
  parseTransaction: jest.fn((rawTx, { signature }) => ({
    signature,
    type: 'TRANSFER',
    nativeTransfers: [],
    tokenTransfers: [],
    slot: rawTx.slot ?? null,
    blockTime: rawTx.blockTime ?? null,
  })),
}));

const tritonRpc = require('../../parser/triton-rpc');
const { parseTransaction } = require('../../parser');
const provider = require('../triton-provider');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getEnhancedTransactionHistory — first page (single call)', () => {
  it('uses getTransactionsForAddress and never the signature-cursor pair', async () => {
    tritonRpc.getTransactionsForAddress.mockResolvedValue({
      transactions: [
        {
          slot: 100,
          blockTime: 1700000000,
          confirmationStatus: 'finalized',
          transaction: { signatures: ['sigA'], message: {} },
          meta: {},
        },
        {
          slot: 99,
          blockTime: 1699999999,
          transaction: { signatures: ['sigB'], message: {} },
          meta: {},
        },
      ],
      paginationToken: '99:2',
    });

    const result = await provider.getEnhancedTransactionHistory('addr', { limit: 5 }, 'mainnet');

    expect(tritonRpc.getTransactionsForAddress).toHaveBeenCalledWith(
      'addr',
      { limit: 5 },
      'mainnet'
    );
    expect(tritonRpc.getSignaturesForAddress).not.toHaveBeenCalled();
    expect(tritonRpc.getParsedTransactionsBatch).not.toHaveBeenCalled();

    expect(result.data).toHaveLength(2);
    expect(result.data[0].signature).toBe('sigA');
    expect(result.data[0].slot).toBe(100);
    expect(result.data[0].confirmationStatus).toBe('finalized');
    // Full mode may omit confirmationStatus — forwarded as undefined, not faked.
    expect(result.data[1].confirmationStatus).toBeUndefined();
    // nextPageToken stays a signature (the oldest tx in the page).
    expect(result.meta.nextPageToken).toBe('sigB');
  });

  it('returns the empty-history shape without enriching', async () => {
    tritonRpc.getTransactionsForAddress.mockResolvedValue({
      transactions: [],
      paginationToken: null,
    });

    const result = await provider.getEnhancedTransactionHistory('addr', { limit: 5 }, 'mainnet');

    expect(result).toEqual({ data: [], meta: { nextPageToken: undefined } });
    expect(parseTransaction).not.toHaveBeenCalled();
  });

  it('drops entries with no signature', async () => {
    tritonRpc.getTransactionsForAddress.mockResolvedValue({
      transactions: [
        { slot: 100, transaction: { signatures: ['sigA'], message: {} }, meta: {} },
        { slot: 99, transaction: { signatures: [], message: {} }, meta: {} },
      ],
      paginationToken: null,
    });

    const result = await provider.getEnhancedTransactionHistory('addr', { limit: 5 }, 'mainnet');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].signature).toBe('sigA');
  });
});

describe('getEnhancedTransactionHistory — endpoint without getTransactionsForAddress', () => {
  const methodNotFound = () => {
    const error = new Error('getTransactionsForAddress failed: Method not found');
    error.code = 'TRITON_RPC_ERROR';
    error.rpcError = { code: -32601, message: 'Method not found' };
    return error;
  };

  it('stays on Triton through the signature-cursor pair and logs once', async () => {
    tritonRpc.getTransactionsForAddress.mockRejectedValue(methodNotFound());
    tritonRpc.getSignaturesForAddress.mockResolvedValue([
      { signature: 'sigA', slot: 10, blockTime: 1600000000, confirmationStatus: 'finalized' },
    ]);
    tritonRpc.getParsedTransactionsBatch.mockResolvedValue([
      {
        slot: 10,
        blockTime: 1600000000,
        transaction: { signatures: ['sigA'], message: {} },
        meta: {},
      },
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const first = await provider.getEnhancedTransactionHistory('addr', { limit: 5 }, 'mainnet');
    const second = await provider.getEnhancedTransactionHistory('addr', { limit: 5 }, 'mainnet');

    expect(tritonRpc.getSignaturesForAddress).toHaveBeenCalledWith(
      'addr',
      { before: undefined, limit: 5 },
      'mainnet'
    );
    expect(first.data.map((tx) => tx.signature)).toEqual(['sigA']);
    expect(first.meta.nextPageToken).toBe('sigA');
    expect(second.data).toHaveLength(1);
    const missingLogs = warn.mock.calls.filter(([message]) =>
      String(message).includes('[TRITON_HISTORY_METHOD_MISSING]')
    );
    expect(missingLogs).toHaveLength(1);
    warn.mockRestore();
  });

  it('surfaces any other RPC error to the resolver', async () => {
    const error = new Error('getTransactionsForAddress failed: boom');
    error.code = 'TRITON_RPC_ERROR';
    error.rpcError = { code: -32000, message: 'boom' };
    tritonRpc.getTransactionsForAddress.mockRejectedValue(error);

    await expect(
      provider.getEnhancedTransactionHistory('addr', { limit: 5 }, 'mainnet')
    ).rejects.toBe(error);
    expect(tritonRpc.getSignaturesForAddress).not.toHaveBeenCalled();
  });
});

describe('getEnhancedTransactionHistory — paginated (signature cursor)', () => {
  it('uses the getSignaturesForAddress + batch path when before is present', async () => {
    tritonRpc.getSignaturesForAddress.mockResolvedValue([
      { signature: 'sigC', slot: 50, blockTime: 1600000000, confirmationStatus: 'finalized' },
    ]);
    tritonRpc.getParsedTransactionsBatch.mockResolvedValue([
      {
        slot: 50,
        blockTime: 1600000000,
        transaction: { signatures: ['sigC'], message: {} },
        meta: {},
      },
    ]);

    const result = await provider.getEnhancedTransactionHistory(
      'addr',
      { limit: 5, before: 'cursorSig' },
      'mainnet'
    );

    expect(tritonRpc.getSignaturesForAddress).toHaveBeenCalledWith(
      'addr',
      { before: 'cursorSig', limit: 5 },
      'mainnet'
    );
    expect(tritonRpc.getTransactionsForAddress).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].signature).toBe('sigC');
    expect(result.meta.nextPageToken).toBe('sigC');
  });
});
