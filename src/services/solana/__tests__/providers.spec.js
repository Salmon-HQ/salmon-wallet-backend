'use strict';

jest.mock('../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((name, fn) => fn({ timeout: 10000, signal: undefined })),
}));

/**
 * Provider abstraction tests.
 *
 * Routing model under test:
 *   - Tx and DAS surfaces → Triton only. There is no second provider: a
 *     Triton failure reaches the caller.
 *
 * Module reload protocol:
 *   `triton-client` captures env vars at module load. Tests that toggle
 *   TRITON_RPC_URL must call `loadFresh()` AFTER setting env, then use the
 *   freshly-required references from the helper. Top-level references would
 *   point to a different factory invocation and would not see test-scope
 *   `mockResolvedValue` calls.
 */

jest.mock('axios');

jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn(() => ({
    getParsedTokenAccountsByOwner: jest.fn().mockResolvedValue({ value: [] }),
  })),
  PublicKey: jest.fn((value) => ({ value })),
}));

jest.mock('@solana/spl-token', () => ({
  TOKEN_2022_PROGRAM_ID: 'token-2022-program-id',
}));

jest.mock('../parser/triton-rpc', () => ({
  getSignaturesForAddress: jest.fn(),
  getParsedTransaction: jest.fn(),
  getParsedTransactionsBatch: jest.fn(),
  getTransactionsForAddress: jest.fn(),
}));

jest.mock('../parser', () => ({
  parseTransaction: jest.fn(),
}));

const loadFresh = () => {
  jest.resetModules();
  return {
    axios: require('axios'),
    tritonRpc: require('../parser/triton-rpc'),
    parser: require('../parser'),
    tritonProvider: require('../providers/triton-provider'),
    resolver: require('../providers'),
  };
};

const ORIGINAL_URL = process.env.TRITON_RPC_URL;
const ORIGINAL_TOKEN = process.env.TRITON_API_TOKEN;
const ORIGINAL_DEVNET = process.env.TRITON_RPC_URL_DEVNET;

afterEach(() => {
  jest.clearAllMocks();
  if (ORIGINAL_URL === undefined) delete process.env.TRITON_RPC_URL;
  else process.env.TRITON_RPC_URL = ORIGINAL_URL;

  if (ORIGINAL_TOKEN === undefined) delete process.env.TRITON_API_TOKEN;
  else process.env.TRITON_API_TOKEN = ORIGINAL_TOKEN;

  if (ORIGINAL_DEVNET === undefined) delete process.env.TRITON_RPC_URL_DEVNET;
  else process.env.TRITON_RPC_URL_DEVNET = ORIGINAL_DEVNET;
});

describe('TritonProvider', () => {
  beforeEach(() => {
    process.env.TRITON_RPC_URL = 'https://test.solana-mainnet.rpcpool.com';
    process.env.TRITON_API_TOKEN = 'test-token';
    delete process.env.TRITON_RPC_URL_DEVNET;
  });

  it('exposes name "triton"', () => {
    const { tritonProvider } = loadFresh();
    expect(tritonProvider.name).toBe('triton');
  });

  it('appends token as path segment per Triton convention', () => {
    const { tritonProvider } = loadFresh();
    expect(tritonProvider.getRpcUrl('mainnet')).toBe(
      'https://test.solana-mainnet.rpcpool.com/test-token'
    );
  });

  it('keeps URL as-is when token is already embedded as path segment', () => {
    process.env.TRITON_RPC_URL = 'https://test.solana-mainnet.rpcpool.com/embedded-token';
    delete process.env.TRITON_API_TOKEN;
    const { tritonProvider } = loadFresh();
    expect(tritonProvider.getRpcUrl('mainnet')).toBe(
      'https://test.solana-mainnet.rpcpool.com/embedded-token'
    );
  });

  it('returns public testnet URL for testnet environment', () => {
    const { tritonProvider } = loadFresh();
    expect(tritonProvider.getRpcUrl('testnet')).toBe('https://api.testnet.solana.com');
  });

  it('returns public devnet URL when TRITON_RPC_URL_DEVNET is unset', () => {
    const { tritonProvider } = loadFresh();
    expect(tritonProvider.getRpcUrl('devnet')).toBe('https://api.devnet.solana.com');
  });

  it('uses TRITON_RPC_URL_DEVNET with token appended as path segment', () => {
    process.env.TRITON_RPC_URL_DEVNET = 'https://test.solana-devnet.rpcpool.com';
    const { tritonProvider } = loadFresh();
    expect(tritonProvider.getRpcUrl('devnet')).toBe(
      'https://test.solana-devnet.rpcpool.com/test-token'
    );
  });

  it('routes single-signature getEnhancedTransactions through parser', async () => {
    const { tritonProvider, tritonRpc, parser } = loadFresh();
    const rawTx = { meta: {}, transaction: {} };
    tritonRpc.getParsedTransaction.mockResolvedValue(rawTx);
    parser.parseTransaction.mockReturnValue({ signature: 'sig-1', type: 'TRANSFER' });

    const result = await tritonProvider.getEnhancedTransactions('sig-1', 'mainnet');

    expect(tritonRpc.getParsedTransaction).toHaveBeenCalledWith('sig-1', 'mainnet');
    expect(parser.parseTransaction).toHaveBeenCalledWith(rawTx, { signature: 'sig-1' });
    expect(result).toEqual({ signature: 'sig-1', type: 'TRANSFER' });
  });

  it('routes array signature getEnhancedTransactions through batch parser', async () => {
    const { tritonProvider, tritonRpc, parser } = loadFresh();
    tritonRpc.getParsedTransactionsBatch.mockResolvedValue([{ a: 1 }, null, { c: 3 }]);
    parser.parseTransaction.mockImplementation((rawTx, opts) =>
      rawTx ? { signature: opts.signature, ok: true } : null
    );

    const result = await tritonProvider.getEnhancedTransactions(['s1', 's2', 's3'], 'mainnet');

    expect(tritonRpc.getParsedTransactionsBatch).toHaveBeenCalledWith(
      ['s1', 's2', 's3'],
      'mainnet'
    );
    expect(result).toEqual([{ signature: 's1', ok: true }, null, { signature: 's3', ok: true }]);
  });

  it('returns first-page history via a single getTransactionsForAddress call', async () => {
    const { tritonProvider, tritonRpc, parser } = loadFresh();
    tritonRpc.getTransactionsForAddress.mockResolvedValue({
      transactions: [
        {
          slot: 100,
          blockTime: 1,
          confirmationStatus: 'finalized',
          transaction: { signatures: ['a'] },
          meta: {},
        },
        { slot: 99, blockTime: 0, transaction: { signatures: ['b'] }, meta: {} },
      ],
      paginationToken: '99:1',
    });
    parser.parseTransaction.mockImplementation((_, opts) => ({ signature: opts.signature }));

    const result = await tritonProvider.getEnhancedTransactionHistory(
      'addr',
      { limit: 10 },
      'mainnet'
    );

    // First page: single call, no signature-cursor round-trips.
    expect(tritonRpc.getTransactionsForAddress).toHaveBeenCalledWith(
      'addr',
      { limit: 10 },
      'mainnet'
    );
    expect(tritonRpc.getSignaturesForAddress).not.toHaveBeenCalled();
    expect(tritonRpc.getParsedTransactionsBatch).not.toHaveBeenCalled();
    // nextPageToken stays a signature (oldest in page) for fallback compatibility.
    expect(result.meta.nextPageToken).toBe('b');
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ signature: 'a', slot: 100, blockTime: 1 });
  });

  it('returns paginated history with nextPageToken from last signature', async () => {
    const { tritonProvider, tritonRpc, parser } = loadFresh();
    tritonRpc.getSignaturesForAddress.mockResolvedValue([
      { signature: 'a', slot: 100, blockTime: 1, confirmationStatus: 'finalized' },
      { signature: 'b', slot: 99, blockTime: 0, confirmationStatus: 'finalized' },
    ]);
    tritonRpc.getParsedTransactionsBatch.mockResolvedValue([{}, {}]);
    parser.parseTransaction.mockImplementation((_, opts) => ({ signature: opts.signature }));

    // `before` cursor → legacy signature-driven path.
    const result = await tritonProvider.getEnhancedTransactionHistory(
      'addr',
      { limit: 10, before: 'cursor' },
      'mainnet'
    );

    expect(tritonRpc.getTransactionsForAddress).not.toHaveBeenCalled();
    expect(result.meta.nextPageToken).toBe('b');
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ signature: 'a', slot: 100, blockTime: 1 });
  });

  it('returns empty data when getSignaturesForAddress is empty', async () => {
    const { tritonProvider, tritonRpc } = loadFresh();
    tritonRpc.getSignaturesForAddress.mockResolvedValue([]);
    // `before` cursor → legacy path, exercising the empty-signatures branch.
    const result = await tritonProvider.getEnhancedTransactionHistory(
      'addr',
      { before: 'cursor' },
      'mainnet'
    );
    expect(result.data).toEqual([]);
    expect(tritonRpc.getParsedTransactionsBatch).not.toHaveBeenCalled();
  });

  it('calls Triton DAS getAsset for getNftMetadata', async () => {
    const { tritonProvider, axios } = loadFresh();
    axios.post.mockResolvedValue({
      data: {
        result: {
          content: {
            metadata: { name: 'Cool NFT', symbol: 'COOL' },
            links: { image: 'https://img/x.png' },
          },
        },
      },
    });

    const result = await tritonProvider.getNftMetadata('mint-1', 'mainnet');

    expect(axios.post).toHaveBeenCalledWith(
      'https://test.solana-mainnet.rpcpool.com/test-token',
      expect.objectContaining({
        method: 'getAsset',
        params: { id: 'mint-1', displayOptions: { showFungible: true } },
      }),
      expect.any(Object)
    );
    expect(result).toEqual({ name: 'Cool NFT', symbol: 'COOL', image: 'https://img/x.png' });
  });

  it('calls Triton DAS getAssets (batch) for getNftMetadataBatch', async () => {
    const { tritonProvider, axios } = loadFresh();
    axios.post.mockResolvedValue({
      data: {
        result: [
          { id: 'mint-a', content: { metadata: { name: 'A' }, links: { image: 'a.png' } } },
          { id: 'mint-b', content: { metadata: { name: 'B' }, links: { image: 'b.png' } } },
        ],
      },
    });

    const result = await tritonProvider.getNftMetadataBatch(['mint-a', 'mint-b'], 'mainnet');
    expect(result.get('mint-a').name).toBe('A');
    expect(result.get('mint-b').name).toBe('B');
  });

  it('returns empty Map when getNftMetadataBatch is called with empty mints', async () => {
    const { tritonProvider, axios } = loadFresh();
    const result = await tritonProvider.getNftMetadataBatch([], 'mainnet');
    expect(result.size).toBe(0);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns null when getNftMetadata DAS response has no content', async () => {
    const { tritonProvider, axios } = loadFresh();
    axios.post.mockResolvedValue({ data: { result: null } });
    const result = await tritonProvider.getNftMetadata('mint-x', 'mainnet');
    expect(result).toBeNull();
  });
});

describe('ProviderResolver', () => {
  it('names Triton as its only provider', () => {
    const { resolver } = loadFresh();
    expect(resolver.primaryName).toBe('triton');
    expect(resolver).not.toHaveProperty('fallbackName');
  });

  describe('when Triton is not configured', () => {
    beforeEach(() => {
      delete process.env.TRITON_RPC_URL;
      delete process.env.TRITON_API_TOKEN;
      delete process.env.TRITON_RPC_URL_DEVNET;
    });

    it('refuses to hand out an RPC URL instead of routing elsewhere', () => {
      const { resolver } = loadFresh();
      expect(() => resolver.getRpcUrl('mainnet')).toThrow(
        expect.objectContaining({ code: 'TRITON_NOT_CONFIGURED' })
      );
    });

    it('reports no enriched path, so history reads the bare RPC', () => {
      const { resolver } = loadFresh();
      expect(resolver.isEnhancedApiSupported('mainnet')).toBe(false);
      expect(resolver.isEnhancedApiSupported('devnet')).toBe(false);
    });
  });

  describe('when Triton is configured', () => {
    beforeEach(() => {
      process.env.TRITON_RPC_URL = 'https://test.solana-mainnet.rpcpool.com';
      process.env.TRITON_API_TOKEN = 'test-token';
    });

    it('uses Triton DAS for getNftMetadata', async () => {
      const { resolver, axios } = loadFresh();
      axios.post.mockResolvedValue({
        data: {
          result: { content: { metadata: { name: 'T' }, links: { image: 't.png' } } },
        },
      });
      const result = await resolver.getNftMetadata('m', 'mainnet');
      expect(result.name).toBe('T');
    });

    it('returns null when Triton DAS fails (triton-provider swallows DAS errors)', async () => {
      const { resolver, axios } = loadFresh();
      axios.post.mockRejectedValue(new Error('boom'));
      expect(await resolver.getNftMetadata('m', 'mainnet')).toBeNull();
    });

    it('surfaces a Triton tx failure and logs it once', async () => {
      const { resolver, tritonRpc } = loadFresh();
      const boom = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
      tritonRpc.getParsedTransaction.mockRejectedValue(boom);
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(resolver.getEnhancedTransactions('s', 'mainnet')).rejects.toBe(boom);

      const logs = errSpy.mock.calls.map((c) => JSON.parse(c[0]));
      expect(logs).toEqual([
        expect.objectContaining({
          component: 'solana-provider-resolver',
          provider: 'triton',
          method: 'getEnhancedTransactions',
          error_code: 'ECONNREFUSED',
        }),
      ]);
      errSpy.mockRestore();
    });

    it('extracts environment from locals for NFT methods', () => {
      const { resolver } = loadFresh();
      const env = resolver.__testing.extractEnvironment('getNftsByOwner', [
        'pubkey',
        {},
        { network: { environment: 'devnet' } },
      ]);
      expect(env).toBe('devnet');
    });

    it('extracts environment from trailing arg for tx methods', () => {
      const { resolver } = loadFresh();
      const env = resolver.__testing.extractEnvironment('getEnhancedTransactions', [
        ['sig'],
        'devnet',
      ]);
      expect(env).toBe('devnet');
    });

    it('isEnhancedApiSupported follows Triton configuration per environment', () => {
      delete process.env.TRITON_RPC_URL_DEVNET;
      const { resolver } = loadFresh();
      expect(resolver.isEnhancedApiSupported('mainnet')).toBe(true);
      expect(resolver.isEnhancedApiSupported('devnet')).toBe(false);
      expect(resolver.isEnhancedApiSupported('testnet')).toBe(false);
    });

    it('returns empty data without enriching when Triton history has no signatures', async () => {
      const { resolver, tritonRpc, parser } = loadFresh();
      // First page goes through getTransactionsForAddress; empty result short-circuits.
      tritonRpc.getTransactionsForAddress.mockResolvedValue({
        transactions: [],
        paginationToken: null,
      });

      const out = await resolver.getEnhancedTransactionHistory('addr', { limit: 10 }, 'mainnet');

      expect(out).toEqual({ data: [], meta: { nextPageToken: undefined } });
      expect(tritonRpc.getParsedTransactionsBatch).not.toHaveBeenCalled();
      expect(parser.parseTransaction).not.toHaveBeenCalled();
    });
  });

  describe('dispatchDasRpc — Umi DAS reads routed by URL', () => {
    beforeEach(() => {
      process.env.TRITON_RPC_URL = 'https://test.solana-mainnet.rpcpool.com';
      process.env.TRITON_API_TOKEN = 'test-token';
    });

    it('runs the operation once against the Triton URL', async () => {
      const { resolver, tritonProvider } = loadFresh();
      const run = jest.fn().mockResolvedValue('asset');

      const result = await resolver.dispatchDasRpc('getAssetWithProof', 'mainnet', run);

      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(tritonProvider.getRpcUrl('mainnet'));
      expect(result).toBe('asset');
    });

    it('rethrows a Triton failure without retrying anywhere else', async () => {
      const { resolver } = loadFresh();
      const boom = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
      const run = jest.fn().mockRejectedValue(boom);
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(resolver.dispatchDasRpc('getAssetWithProof', 'mainnet', run)).rejects.toBe(boom);
      expect(run).toHaveBeenCalledTimes(1);
      errSpy.mockRestore();
    });
  });

  describe('redact() / sanitizePayload() — security', () => {
    const TOKEN = 'super-secret-triton-token-1234567890';

    beforeEach(() => {
      process.env.TRITON_RPC_URL = 'https://test.solana-mainnet.rpcpool.com';
      process.env.TRITON_API_TOKEN = TOKEN;
    });

    it('replaces TRITON_API_TOKEN with [REDACTED] anywhere in the string', () => {
      const { resolver } = loadFresh();
      const dirty = `axios timeout while fetching https://x.rpcpool.com/${TOKEN}`;
      const safe = resolver.__testing.redact(dirty);
      expect(safe).not.toContain(TOKEN);
      expect(safe).toContain('[REDACTED]');
    });

    it('redacts rpcpool.com path segments even without TRITON_API_TOKEN set', () => {
      delete process.env.TRITON_API_TOKEN;
      const { resolver } = loadFresh();
      const dirty =
        'request to https://x.solana-mainnet.rpcpool.com/some-secret-path-segment failed';
      const safe = resolver.__testing.redact(dirty);
      expect(safe).not.toContain('some-secret-path-segment');
      expect(safe).toContain('rpcpool.com/[REDACTED]');
    });

    it('returns non-string inputs unchanged', () => {
      const { resolver } = loadFresh();
      expect(resolver.__testing.redact(undefined)).toBeUndefined();
      expect(resolver.__testing.redact(null)).toBeNull();
      expect(resolver.__testing.redact(42)).toBe(42);
    });

    it('sanitizePayload redacts error_message and reason fields', () => {
      const { resolver } = loadFresh();
      const out = resolver.__testing.sanitizePayload({
        method: 'getEnhancedTransactions',
        provider: 'triton',
        error_message: `Network error: https://x.rpcpool.com/${TOKEN}`,
        reason: `budget exhausted hitting ${TOKEN}`,
        latency_ms: 100,
      });
      expect(out.error_message).not.toContain(TOKEN);
      expect(out.reason).not.toContain(TOKEN);
      expect(out.method).toBe('getEnhancedTransactions');
      expect(out.latency_ms).toBe(100);
    });

    it('sanitizePayload leaves payloads without sensitive fields intact', () => {
      const { resolver } = loadFresh();
      const payload = { method: 'foo', provider: 'triton', latency_ms: 50 };
      expect(resolver.__testing.sanitizePayload(payload)).toEqual(payload);
    });
  });
});
