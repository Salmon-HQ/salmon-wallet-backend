'use strict';

process.env.HELIUS_API_KEY = process.env.HELIUS_API_KEY || 'test-helius-key';

jest.mock('@solana/web3.js', () => {
  const getParsedTransaction = jest.fn();
  const getSignaturesForAddress = jest.fn();
  const mockConnection = jest.fn(() => ({
    getParsedTransaction,
    getSignaturesForAddress,
  }));

  return {
    Connection: mockConnection,
    PublicKey: jest.fn((value) => ({ value })),
  };
});

// `solana-transaction-service` now consumes the provider resolver (`./providers`)
// instead of the raw helius-transaction-service. The test stubs the resolver
// methods directly — provider routing is covered by providers.spec.js.
jest.mock('../providers', () => ({
  getEnhancedTransactions: jest.fn(),
  getEnhancedTransactionHistory: jest.fn(),
  getNftMetadataBatch: jest.fn(),
  isTransactionParsed: jest.fn(),
  // Gate moved to resolver — default to true so existing test fixtures keep
  // exercising the enhanced path. Tests that assert the testnet skip override
  // this per-test.
  isEnhancedApiSupported: jest.fn(() => true),
}));

jest.mock('../solana-ft-service', () => ({
  list: jest.fn(),
}));

// The RPC fallback path preloads resource lookups via solana-rpc-enrichment;
// stub its data sources so unit tests stay hermetic.
jest.mock('../solana-nft-service', () => ({
  find: jest.fn(),
}));

jest.mock('../solana-address-service', () => ({
  getTokenAccounts: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../resources/solana/helius-transaction-resource', () => {
  const mock = jest.fn();
  // The service imports the real shared helper from the resource module.
  mock.buildTokenLookup = jest.requireActual(
    '../../../resources/solana/helius-transaction-resource'
  ).buildTokenLookup;
  return mock;
});

const { Connection } = require('@solana/web3.js');
const heliusService = require('../providers');
const solanaFtService = require('../solana-ft-service');
const heliusTransactionResource = require('../../../resources/solana/helius-transaction-resource');
const service = require('../solana-transaction-service');

describe('Solana Transaction Service - unit tests', () => {
  const locals = {
    network: {
      id: 'solana-mainnet',
      environment: 'mainnet',
      config: {
        nodeUrl: 'https://mainnet.helius-rpc.com/?api-key=test-helius-key',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should batch NFT metadata per page and reuse it for each transformed transaction', async () => {
    const address = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
    const nftMetadataByMint = new Map([
      ['nft-1', { name: 'NFT One' }],
      ['nft-2', { name: 'NFT Two' }],
    ]);

    heliusService.getEnhancedTransactionHistory.mockResolvedValue({
      data: [
        {
          signature: 'sig-1',
          timestamp: 123,
          tokenTransfers: [{ mint: 'nft-1', tokenStandard: 'NonFungible' }],
        },
        {
          signature: 'sig-2',
          timestamp: 122,
          tokenTransfers: [
            { mint: 'nft-1', tokenStandard: 'NonFungible' },
            { mint: 'nft-2', tokenStandard: 'NonFungibleEdition' },
          ],
        },
      ],
      meta: {
        nextPageToken: 'sig-2',
      },
    });

    heliusService.getNftMetadataBatch.mockResolvedValue(nftMetadataByMint);
    solanaFtService.list.mockResolvedValue([{ address: 'token-1', name: 'USD Coin' }]);
    heliusTransactionResource.mockImplementation(async (tx, txAddress, tokenLookup, options) => ({
      id: tx.signature,
      timestamp: tx.timestamp,
      status: 'completed',
      type: 'receive',
      inputs: [],
      outputs: [],
      hasMetadata: options.nftMetadataByMint === nftMetadataByMint,
      hasTokenLookup: tokenLookup instanceof Map,
      txAddress,
    }));

    const result = await service.getTransactions(address, { pageSize: 10 }, locals);

    expect(heliusService.getEnhancedTransactionHistory).toHaveBeenCalledWith(
      address,
      { before: undefined, limit: 10 },
      'mainnet'
    );
    expect(heliusService.getNftMetadataBatch).toHaveBeenCalledTimes(1);
    expect(heliusService.getNftMetadataBatch).toHaveBeenCalledWith(
      expect.arrayContaining(['nft-1', 'nft-2']),
      'mainnet'
    );
    expect(heliusTransactionResource).toHaveBeenCalledTimes(2);
    expect(result.data).toHaveLength(2);
    result.data.forEach((tx) => {
      expect(tx._source).toBe('enriched');
      expect(tx.hasMetadata).toBe(true);
      expect(tx.hasTokenLookup).toBe(true);
    });
  });

  test('should skip token list loading when the page has only native transfers', async () => {
    const address = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';

    heliusService.getEnhancedTransactionHistory.mockResolvedValue({
      data: [
        {
          signature: 'sig-native',
          timestamp: 123,
          type: 'TRANSFER',
          nativeTransfers: [
            {
              amount: 1000,
              fromUserAccount: 'sender-address',
              toUserAccount: address,
            },
          ],
          tokenTransfers: [],
        },
      ],
      meta: {
        nextPageToken: 'sig-native',
      },
    });

    heliusTransactionResource.mockImplementation(async (tx, txAddress, tokenLookup, options) => ({
      id: tx.signature,
      timestamp: tx.timestamp,
      status: 'completed',
      type: 'receive',
      inputs: [],
      outputs: [],
      hasTokenLookup: tokenLookup instanceof Map,
      metadataSize: options.nftMetadataByMint.size,
      txAddress,
    }));

    const result = await service.getTransactions(address, { pageSize: 10 }, locals);

    expect(solanaFtService.list).not.toHaveBeenCalled();
    expect(heliusService.getNftMetadataBatch).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      _source: 'enriched',
      hasTokenLookup: true,
      metadataSize: 0,
    });
  });

  test('should fallback to RPC history when Helius transaction history fails', async () => {
    const address = 'fallback-history-address';
    const getParsedTransaction = jest.fn().mockResolvedValue({ slot: 321, meta: { err: null } });
    const getSignaturesForAddress = jest.fn().mockResolvedValue([{ signature: 'sig-1' }]);

    heliusService.getEnhancedTransactionHistory.mockRejectedValue(new Error('timeout'));
    Connection.mockImplementation(() => ({
      getSignaturesForAddress,
      getParsedTransaction,
    }));

    const result = await service.getTransactions(address, { pageSize: 1 }, locals);

    expect(Connection).toHaveBeenCalledWith(locals.network.config.nodeUrl, 'confirmed');
    expect(getSignaturesForAddress).toHaveBeenCalled();
    expect(getParsedTransaction).toHaveBeenCalledWith('sig-1', {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    expect(result).toEqual({
      data: [
        {
          address,
          signature: 'sig-1',
          slot: 321,
          meta: { err: null },
          _source: 'rpc-standard',
        },
      ],
      meta: {
        nextPageToken: 'sig-1',
      },
    });
  });

  test('skips enhanced path entirely when isEnhancedApiSupported returns false (testnet)', async () => {
    const address = 'testnet-address';
    heliusService.isEnhancedApiSupported.mockReturnValueOnce(false);

    const getParsedTransaction = jest.fn().mockResolvedValue({ slot: 999, meta: { err: null } });
    const getSignaturesForAddress = jest.fn().mockResolvedValue([{ signature: 'tn-sig' }]);
    Connection.mockImplementation(() => ({
      getSignaturesForAddress,
      getParsedTransaction,
    }));

    const result = await service.getTransactions(
      address,
      { pageSize: 1 },
      {
        network: {
          id: 'solana-testnet',
          environment: 'testnet',
          config: { nodeUrl: 'https://testnet.solana.com' },
        },
      }
    );

    expect(heliusService.getEnhancedTransactionHistory).not.toHaveBeenCalled();
    expect(getSignaturesForAddress).toHaveBeenCalled();
    expect(result.data[0]).toMatchObject({ signature: 'tn-sig', _source: 'rpc-standard' });
  });

  test('should throw when RPC fallback is required but nodeUrl is missing', async () => {
    heliusService.getEnhancedTransactionHistory.mockRejectedValue(new Error('timeout'));

    await expect(
      service.getTransactions(
        'address-without-rpc',
        { pageSize: 1 },
        {
          network: {
            id: 'solana-mainnet',
            environment: 'mainnet',
            config: {},
          },
        }
      )
    ).rejects.toThrow('No RPC URL configured for network');
  });

  test('caps the enhanced page size at the Helius maximum', async () => {
    heliusService.getEnhancedTransactionHistory.mockResolvedValue({ data: [], meta: {} });

    await service.getTransactions('capped-address', { pageSize: 5000 }, locals);

    expect(heliusService.getEnhancedTransactionHistory).toHaveBeenCalledWith(
      'capped-address',
      { before: undefined, limit: 100 },
      'mainnet'
    );
  });

  test('fans out RPC transaction fetches in batches of 50', async () => {
    const signatures = Array.from({ length: 120 }, (_, i) => ({ signature: `sig-${i}` }));
    let inFlight = 0;
    let peak = 0;
    const getParsedTransaction = jest.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return { slot: 1, meta: { err: null } };
    });
    heliusService.getEnhancedTransactionHistory.mockRejectedValue(new Error('timeout'));
    Connection.mockImplementation(() => ({
      getSignaturesForAddress: jest.fn().mockResolvedValue(signatures),
      getParsedTransaction,
    }));

    const result = await service.getTransactions('batched-address', { pageSize: 120 }, locals);

    expect(getParsedTransaction).toHaveBeenCalledTimes(120);
    expect(peak).toBe(50);
    expect(result.data.map((tx) => tx.signature)).toEqual(signatures.map((s) => s.signature));
  });
});
