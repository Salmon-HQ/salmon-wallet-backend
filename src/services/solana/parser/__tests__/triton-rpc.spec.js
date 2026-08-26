'use strict';

/**
 * triton-rpc thin axios wrapper tests.
 *
 * Verifies:
 *   - URL is built via tritonClient.getRpcUrl(env)
 *   - JSON-RPC envelope shape (jsonrpc 2.0, params)
 *   - getParsedTransactionsBatch dispatches a batch payload + maps responses
 *     back to signature order via the `id` field
 *   - error envelopes raise with code 'TRITON_RPC_ERROR'
 */

jest.mock('axios');
jest.mock('../../../../infrastructure/triton-client', () => ({
  getRpcUrl: jest.fn(),
}));

const axios = require('axios');
const tritonClient = require('../../../../infrastructure/triton-client');
const tritonRpc = require('../triton-rpc');

const URL = 'https://test.solana-mainnet.rpcpool.com?api-key=test';

beforeEach(() => {
  jest.clearAllMocks();
  tritonClient.getRpcUrl.mockReturnValue(URL);
});

describe('getSignaturesForAddress', () => {
  it('calls Triton RPC with limit + before + commitment, returns result array', async () => {
    axios.post.mockResolvedValue({ data: { result: [{ signature: 's1' }, { signature: 's2' }] } });

    const result = await tritonRpc.getSignaturesForAddress(
      'addr',
      { before: 'b', limit: 5 },
      'mainnet'
    );

    expect(tritonClient.getRpcUrl).toHaveBeenCalledWith('mainnet');
    expect(axios.post).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({
        jsonrpc: '2.0',
        method: 'getSignaturesForAddress',
        params: ['addr', expect.objectContaining({ before: 'b', limit: 5 })],
      }),
      expect.any(Object)
    );
    expect(result).toEqual([{ signature: 's1' }, { signature: 's2' }]);
  });

  it('returns [] when result is missing', async () => {
    axios.post.mockResolvedValue({ data: {} });
    const result = await tritonRpc.getSignaturesForAddress('addr', {}, 'mainnet');
    expect(result).toEqual([]);
  });

  it('throws TRITON_RPC_ERROR on RPC error envelope', async () => {
    axios.post.mockResolvedValue({ data: { error: { code: -32000, message: 'rate limited' } } });
    await expect(tritonRpc.getSignaturesForAddress('addr', {}, 'mainnet')).rejects.toThrow(
      'rate limited'
    );
  });
});

describe('getParsedTransaction', () => {
  it('uses jsonParsed encoding + maxSupportedTransactionVersion=0', async () => {
    axios.post.mockResolvedValue({ data: { result: { slot: 1 } } });

    const result = await tritonRpc.getParsedTransaction('sig-1', 'mainnet');

    expect(axios.post).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({
        method: 'getTransaction',
        params: [
          'sig-1',
          expect.objectContaining({
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
            encoding: 'jsonParsed',
          }),
        ],
      }),
      expect.any(Object)
    );
    expect(result).toEqual({ slot: 1 });
  });

  it('returns null when result is missing', async () => {
    axios.post.mockResolvedValue({ data: { result: null } });
    const result = await tritonRpc.getParsedTransaction('sig-x', 'mainnet');
    expect(result).toBeNull();
  });
});

describe('getParsedTransactionsBatch', () => {
  it('returns [] when signatures is empty', async () => {
    const result = await tritonRpc.getParsedTransactionsBatch([], 'mainnet');
    expect(result).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('sends a batch payload, maps responses by id back to signature order', async () => {
    // Provider returns out-of-order with mixed numeric / string ids — verify
    // both pass through the correlation logic.
    axios.post.mockResolvedValue({
      data: [
        { id: 2, result: { slot: 3 } },
        { id: '0', result: { slot: 1 } },
        { id: 1, result: null },
      ],
    });

    const result = await tritonRpc.getParsedTransactionsBatch(['s1', 's2', 's3'], 'mainnet');

    const body = axios.post.mock.calls[0][1];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
    expect(body[0].id).toBe(0);
    expect(body[2].id).toBe(2);

    expect(result).toEqual([{ slot: 1 }, null, { slot: 3 }]);
  });

  it('throws TRITON_RPC_ERROR when batch returns a single error envelope', async () => {
    axios.post.mockResolvedValue({ data: { error: { message: 'service unavailable' } } });
    await expect(tritonRpc.getParsedTransactionsBatch(['s1'], 'mainnet')).rejects.toThrow(
      'service unavailable'
    );
  });
});

describe('getTransactionsForAddress', () => {
  it('sends a full-detail jsonParsed request and unwraps result.data + paginationToken', async () => {
    axios.post.mockResolvedValue({
      data: {
        result: {
          data: [
            { slot: 10, transaction: { signatures: ['s1'] }, meta: {} },
            { slot: 9, transaction: { signatures: ['s2'] }, meta: {} },
          ],
          paginationToken: '9:3',
        },
      },
    });

    const result = await tritonRpc.getTransactionsForAddress('addr', { limit: 5 }, 'mainnet');

    expect(tritonClient.getRpcUrl).toHaveBeenCalledWith('mainnet');
    expect(axios.post).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({
        jsonrpc: '2.0',
        method: 'getTransactionsForAddress',
        params: [
          'addr',
          expect.objectContaining({
            limit: 5,
            sortOrder: 'desc',
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
            encoding: 'jsonParsed',
            transactionDetails: 'full',
          }),
        ],
      }),
      expect.any(Object)
    );
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].transaction.signatures[0]).toBe('s1');
    expect(result.paginationToken).toBe('9:3');
  });

  it('defaults limit + returns empty transactions and null token when result is missing', async () => {
    axios.post.mockResolvedValue({ data: { result: {} } });

    const result = await tritonRpc.getTransactionsForAddress('addr', {}, 'mainnet');

    const body = axios.post.mock.calls[0][1];
    expect(body.params[1].limit).toBe(10);
    expect(result.transactions).toEqual([]);
    expect(result.paginationToken).toBeNull();
  });

  it('throws TRITON_RPC_ERROR on RPC error envelope', async () => {
    axios.post.mockResolvedValue({ data: { error: { code: -32000, message: 'rate limited' } } });
    await expect(tritonRpc.getTransactionsForAddress('addr', {}, 'mainnet')).rejects.toThrow(
      'rate limited'
    );
  });
});
