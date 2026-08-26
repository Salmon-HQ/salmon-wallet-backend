'use strict';

/**
 * Provider abstraction tests.
 *
 * Routing model under test:
 *   - Tx surface  → Triton primary, Helius fallback (rate-limited)
 *   - DAS surface → Triton primary, Helius fallback (same budget as tx).
 *                   `triton-provider` swallows its own DAS errors, so most DAS
 *                   failures never reach the fallback.
 *
 * Module reload protocol:
 *   `triton-client` captures env vars at module load. Tests that toggle
 *   TRITON_RPC_URL must call `loadFresh()` AFTER setting env, then use the
 *   freshly-required references from the helper. Top-level references would
 *   point to a different factory invocation and would not see test-scope
 *   `mockResolvedValue` calls.
 */

process.env.HELIUS_API_KEY = process.env.HELIUS_API_KEY || 'test-helius-key';

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

jest.mock('../helius-transaction-service', () => ({
  getEnhancedTransactions: jest.fn(),
  getEnhancedTransactionHistory: jest.fn(),
  isTransactionParsed: jest.fn(),
  getNftMetadata: jest.fn(),
  getNftMetadataBatch: jest.fn(),
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
    heliusService: require('../helius-transaction-service'),
    tritonRpc: require('../parser/triton-rpc'),
    parser: require('../parser'),
    tritonProvider: require('../providers/triton-provider'),
    heliusProvider: require('../providers/helius-provider'),
    resolver: require('../providers'),
  };
};

const ORIGINAL_URL = process.env.TRITON_RPC_URL;
const ORIGINAL_TOKEN = process.env.TRITON_API_TOKEN;
const ORIGINAL_DEVNET = process.env.TRITON_RPC_URL_DEVNET;
const ORIGINAL_RPS = process.env.SOLANA_FALLBACK_MAX_RPS;

afterEach(() => {
  jest.clearAllMocks();
  if (ORIGINAL_URL === undefined) delete process.env.TRITON_RPC_URL;
  else process.env.TRITON_RPC_URL = ORIGINAL_URL;

  if (ORIGINAL_TOKEN === undefined) delete process.env.TRITON_API_TOKEN;
  else process.env.TRITON_API_TOKEN = ORIGINAL_TOKEN;

  if (ORIGINAL_DEVNET === undefined) delete process.env.TRITON_RPC_URL_DEVNET;
  else process.env.TRITON_RPC_URL_DEVNET = ORIGINAL_DEVNET;

  if (ORIGINAL_RPS === undefined) delete process.env.SOLANA_FALLBACK_MAX_RPS;
  else process.env.SOLANA_FALLBACK_MAX_RPS = ORIGINAL_RPS;
});

describe('HeliusProvider', () => {
  it('exposes name "helius"', () => {
    const { heliusProvider } = loadFresh();
    expect(heliusProvider.name).toBe('helius');
  });

  it('delegates getEnhancedTransactions to helius-transaction-service', async () => {
    const { heliusProvider, heliusService } = loadFresh();
    heliusService.getEnhancedTransactions.mockResolvedValue([{ signature: 'sig1' }]);
    const result = await heliusProvider.getEnhancedTransactions(['sig1'], 'mainnet');
    expect(heliusService.getEnhancedTransactions).toHaveBeenCalledWith(['sig1'], 'mainnet');
    expect(result).toEqual([{ signature: 'sig1' }]);
  });

  it('delegates getEnhancedTransactionHistory to helius-transaction-service', async () => {
    const { heliusProvider, heliusService } = loadFresh();
    heliusService.getEnhancedTransactionHistory.mockResolvedValue({
      data: [],
      meta: { nextPageToken: undefined },
    });
    const result = await heliusProvider.getEnhancedTransactionHistory(
      'addr',
      { limit: 10 },
      'mainnet'
    );
    expect(heliusService.getEnhancedTransactionHistory).toHaveBeenCalledWith(
      'addr',
      { limit: 10 },
      'mainnet'
    );
    expect(result.data).toEqual([]);
  });

  it('delegates getNftMetadata to helius-transaction-service', async () => {
    const { heliusProvider, heliusService } = loadFresh();
    heliusService.getNftMetadata.mockResolvedValue({ name: 'NFT', symbol: 'SYM', image: 'url' });
    const result = await heliusProvider.getNftMetadata('mint-addr', 'mainnet');
    expect(heliusService.getNftMetadata).toHaveBeenCalledWith('mint-addr', 'mainnet');
    expect(result.name).toBe('NFT');
  });
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
      expect.objectContaining({ method: 'getAsset', params: { id: 'mint-1' } }),
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
  describe('when Triton is not configured', () => {
    beforeEach(() => {
      delete process.env.TRITON_RPC_URL;
      delete process.env.TRITON_API_TOKEN;
      delete process.env.TRITON_RPC_URL_DEVNET;
    });

    it('routes tx surface directly to Helius (no Triton attempt)', async () => {
      const { resolver, heliusService } = loadFresh();
      heliusService.getEnhancedTransactions.mockResolvedValue([{ signature: 's' }]);
      const result = await resolver.getEnhancedTransactions(['s'], 'mainnet');
      expect(heliusService.getEnhancedTransactions).toHaveBeenCalled();
      expect(result).toEqual([{ signature: 's' }]);
    });

    it('routes DAS surface directly to Helius (no Triton attempt)', async () => {
      const { resolver, heliusService } = loadFresh();
      heliusService.getNftMetadata.mockResolvedValue({ name: 'X', symbol: null, image: null });
      const result = await resolver.getNftMetadata('m', 'mainnet');
      expect(heliusService.getNftMetadata).toHaveBeenCalledWith('m', 'mainnet');
      expect(result.name).toBe('X');
    });

    it('exposes Triton as primaryName and Helius as fallbackName regardless', () => {
      const { resolver } = loadFresh();
      expect(resolver.primaryName).toBe('triton');
      expect(resolver.fallbackName).toBe('helius');
    });
  });

  describe('when Triton is configured', () => {
    beforeEach(() => {
      process.env.TRITON_RPC_URL = 'https://test.solana-mainnet.rpcpool.com';
      process.env.TRITON_API_TOKEN = 'test-token';
      process.env.SOLANA_FALLBACK_MAX_RPS = '5';
    });

    it('uses Triton DAS for getNftMetadata when configured', async () => {
      const { resolver, axios, heliusService } = loadFresh();
      axios.post.mockResolvedValue({
        data: {
          result: { content: { metadata: { name: 'T' }, links: { image: 't.png' } } },
        },
      });
      const result = await resolver.getNftMetadata('m', 'mainnet');
      expect(result.name).toBe('T');
      expect(heliusService.getNftMetadata).not.toHaveBeenCalled();
    });

    it('does not reach the Helius fallback because triton-provider swallows DAS errors', async () => {
      const { resolver, axios, heliusService } = loadFresh();
      axios.post.mockRejectedValue(new Error('boom'));
      const result = await resolver.getNftMetadata('m', 'mainnet');
      // triton-provider swallows DAS errors and returns null
      expect(result).toBeNull();
      expect(heliusService.getNftMetadata).not.toHaveBeenCalled();
    });

    it('falls back to Helius for tx surface when Triton tx call throws network error', async () => {
      const { resolver, tritonRpc, heliusService } = loadFresh();
      tritonRpc.getParsedTransaction.mockRejectedValue(
        Object.assign(new Error('boom'), { code: 'ECONNREFUSED' })
      );
      heliusService.getEnhancedTransactions.mockResolvedValue([{ signature: 'fb' }]);
      const result = await resolver.getEnhancedTransactions('fb', 'mainnet');
      expect(heliusService.getEnhancedTransactions).toHaveBeenCalledWith('fb', 'mainnet');
      expect(result).toEqual([{ signature: 'fb' }]);
    });

    it('respects fallback rate limit and rethrows when budget exhausted', async () => {
      const { resolver, tritonRpc, heliusService } = loadFresh();
      tritonRpc.getParsedTransaction.mockRejectedValue(
        Object.assign(new Error('boom'), { code: 'ECONNREFUSED' })
      );
      heliusService.getEnhancedTransactions.mockResolvedValue([{ signature: 'fb' }]);
      resolver.__testing.resetBudget();

      const calls = [];
      for (let i = 0; i < 5; i += 1) {
        calls.push(resolver.getEnhancedTransactions('s', 'mainnet'));
      }
      await Promise.all(calls);
      expect(heliusService.getEnhancedTransactions).toHaveBeenCalledTimes(5);

      await expect(resolver.getEnhancedTransactions('s', 'mainnet')).rejects.toThrow();
      expect(heliusService.getEnhancedTransactions).toHaveBeenCalledTimes(5);
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

    it('isEnhancedApiSupported returns true when Triton is configured', () => {
      const { resolver } = loadFresh();
      expect(resolver.isEnhancedApiSupported('mainnet')).toBe(true);
    });

    it('isEnhancedApiSupported returns true for devnet via Helius even when Triton devnet not configured', () => {
      delete process.env.TRITON_RPC_URL_DEVNET;
      const { resolver } = loadFresh();
      // Helius supports devnet, so the gate must hold even without Triton devnet.
      expect(resolver.isEnhancedApiSupported('devnet')).toBe(true);
    });

    it('isEnhancedApiSupported returns false for testnet (neither provider supports)', () => {
      const { resolver } = loadFresh();
      expect(resolver.isEnhancedApiSupported('testnet')).toBe(false);
    });

    it('rethrows fallback error and logs fallback_failed when Helius also fails', async () => {
      const { resolver, tritonRpc, heliusService } = loadFresh();
      tritonRpc.getParsedTransaction.mockRejectedValue(
        Object.assign(new Error('triton boom'), { code: 'ECONNREFUSED' })
      );
      heliusService.getEnhancedTransactions.mockRejectedValue(
        Object.assign(new Error('helius boom'), { code: 'ETIMEDOUT' })
      );
      resolver.__testing.resetBudget();

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(resolver.getEnhancedTransactions('s', 'mainnet')).rejects.toThrow('helius boom');

      const failedLog = errSpy.mock.calls
        .map((c) => JSON.parse(c[0]))
        .find((p) => p.fallback_failed === true);
      expect(failedLog).toMatchObject({
        provider: 'helius',
        fallback_used: true,
        fallback_failed: true,
        error_code: 'ETIMEDOUT',
      });

      errSpy.mockRestore();
    });

    it('tags auth_error:true on the fallback log when Triton returns 401/403', async () => {
      const { resolver, tritonRpc, heliusService } = loadFresh();
      tritonRpc.getParsedTransaction.mockRejectedValue(
        Object.assign(new Error('forbidden'), { response: { status: 403 } })
      );
      heliusService.getEnhancedTransactions.mockResolvedValue([{ signature: 'ok' }]);
      resolver.__testing.resetBudget();

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await resolver.getEnhancedTransactions('s', 'mainnet');

      const authLog = warnSpy.mock.calls
        .map((c) => JSON.parse(c[0]))
        .find((p) => p.auth_error === true);
      expect(authLog).toMatchObject({
        provider: 'triton',
        fallback_used: true,
        auth_error: true,
      });

      warnSpy.mockRestore();
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
    const transientError = () => Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });

    it('runs the operation against the Helius URL when Triton is not configured', async () => {
      delete process.env.TRITON_RPC_URL;
      delete process.env.TRITON_API_TOKEN;
      const { resolver, heliusProvider } = loadFresh();
      const run = jest.fn().mockResolvedValue('asset');

      const result = await resolver.dispatchDasRpc('getAssetWithProof', 'mainnet', run);

      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(heliusProvider.getRpcUrl('mainnet'));
      expect(result).toBe('asset');
    });

    it('runs the operation against the Triton URL and does not retry on success', async () => {
      process.env.TRITON_RPC_URL = 'https://test.solana-mainnet.rpcpool.com';
      process.env.TRITON_API_TOKEN = 'test-token';
      const { resolver, tritonProvider } = loadFresh();
      const run = jest.fn().mockResolvedValue('asset');

      const result = await resolver.dispatchDasRpc('getAssetWithProof', 'mainnet', run);

      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(tritonProvider.getRpcUrl('mainnet'));
      expect(result).toBe('asset');
    });

    it('retries against the Helius URL when the Triton attempt fails with a network error', async () => {
      process.env.TRITON_RPC_URL = 'https://test.solana-mainnet.rpcpool.com';
      process.env.TRITON_API_TOKEN = 'test-token';
      process.env.SOLANA_FALLBACK_MAX_RPS = '5';
      const { resolver, tritonProvider, heliusProvider } = loadFresh();
      resolver.__testing.resetBudget();
      const run = jest.fn().mockRejectedValueOnce(transientError()).mockResolvedValueOnce('asset');

      const result = await resolver.dispatchDasRpc('getAssetWithProof', 'mainnet', run);

      expect(run).toHaveBeenNthCalledWith(1, tritonProvider.getRpcUrl('mainnet'));
      expect(run).toHaveBeenNthCalledWith(2, heliusProvider.getRpcUrl('mainnet'));
      expect(result).toBe('asset');
    });

    it('rethrows without retrying when the Triton attempt fails with a caller-side error', async () => {
      process.env.TRITON_RPC_URL = 'https://test.solana-mainnet.rpcpool.com';
      process.env.TRITON_API_TOKEN = 'test-token';
      const { resolver } = loadFresh();
      resolver.__testing.resetBudget();
      const badRequest = Object.assign(new Error('bad request'), {
        response: { status: 400 },
      });
      const run = jest.fn().mockRejectedValue(badRequest);

      await expect(resolver.dispatchDasRpc('getAssetWithProof', 'mainnet', run)).rejects.toBe(
        badRequest
      );
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('rethrows the Triton error once the fallback budget is exhausted', async () => {
      process.env.TRITON_RPC_URL = 'https://test.solana-mainnet.rpcpool.com';
      process.env.TRITON_API_TOKEN = 'test-token';
      process.env.SOLANA_FALLBACK_MAX_RPS = '1';
      const { resolver } = loadFresh();
      resolver.__testing.resetBudget();

      const firstRun = jest
        .fn()
        .mockRejectedValueOnce(transientError())
        .mockResolvedValueOnce('asset');
      await resolver.dispatchDasRpc('getAssetWithProof', 'mainnet', firstRun);

      const secondRun = jest.fn().mockRejectedValue(transientError());
      await expect(
        resolver.dispatchDasRpc('getAssetWithProof', 'mainnet', secondRun)
      ).rejects.toThrow('boom');
      expect(secondRun).toHaveBeenCalledTimes(1);
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
