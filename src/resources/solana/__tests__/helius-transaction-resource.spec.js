'use strict';

jest.mock('../../../services/solana/helius-transaction-service', () => ({
  getNftMetadataBatch: jest.fn(),
}));

const { getNftMetadataBatch } = require('../../../services/solana/helius-transaction-service');
const transformTransaction = require('../helius-transaction-resource');
const {
  SEND,
  RECEIVE,
  SWAP,
  MINT,
  BURN,
  STAKE,
  INTERACTION,
  UNKNOWN,
} = require('../../../constants/transaction-types');

describe('Helius Transaction Resource - Unit Tests', () => {
  const mockAddress = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Type Mapping', () => {
    test('should map SWAP type correctly', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'SWAP',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [
          {
            fromUserAccount: mockAddress,
            toUserAccount: 'other-address',
            tokenAmount: '1000000',
            mint: 'So11111111111111111111111111111111111111112',
            decimals: 9,
            symbol: 'SOL',
          },
        ],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.type).toBe(SWAP);
      expect(result.id).toBe('test-sig');
      expect(result.status).toBe('completed');
    });

    test('should map TRANSFER to SEND when user is sender', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'TRANSFER',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [
          {
            fromUserAccount: mockAddress,
            toUserAccount: 'recipient-address',
            tokenAmount: '1000000',
            mint: 'token-mint',
            decimals: 6,
            symbol: 'USDC',
          },
        ],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.type).toBe(SEND);
    });

    test('should map TRANSFER to RECEIVE when user is receiver', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'TRANSFER',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: 'sender-address',
        tokenTransfers: [
          {
            fromUserAccount: 'sender-address',
            toUserAccount: mockAddress,
            tokenAmount: '1000000',
            mint: 'token-mint',
            decimals: 6,
            symbol: 'USDC',
          },
        ],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.type).toBe(RECEIVE);
    });

    test('should map TOKEN_MINT to MINT', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'TOKEN_MINT',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.type).toBe(MINT);
    });

    test('should map NFT operations to INTERACTION', async () => {
      const interactionTypes = ['NFT_SALE', 'NFT_BID', 'NFT_LISTING'];

      for (const type of interactionTypes) {
        const heliusTx = {
          signature: 'test-sig',
          type,
          timestamp: 1234567890,
          fee: 5000,
          feePayer: mockAddress,
          tokenTransfers: [],
          nativeTransfers: [],
        };

        const result = await transformTransaction(heliusTx, mockAddress);
        expect(result.type).toBe(INTERACTION);
      }
    });

    test('should map BURN types to BURN', async () => {
      for (const type of ['BURN', 'BURN_NFT']) {
        const heliusTx = {
          signature: 'test-sig',
          type,
          timestamp: 1234567890,
          fee: 5000,
          feePayer: mockAddress,
          tokenTransfers: [],
          nativeTransfers: [],
        };

        const result = await transformTransaction(heliusTx, mockAddress);
        expect(result.type).toBe(BURN);
      }
    });

    test('should map COMPRESSED_NFT_MINT to MINT', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'COMPRESSED_NFT_MINT',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [],
        nativeTransfers: [],
      };
      const result = await transformTransaction(heliusTx, mockAddress);
      expect(result.type).toBe(MINT);
    });

    test('should map COMPRESSED_NFT_BURN to BURN', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'COMPRESSED_NFT_BURN',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [],
        nativeTransfers: [],
      };
      const result = await transformTransaction(heliusTx, mockAddress);
      expect(result.type).toBe(BURN);
    });

    test('COMPRESSED_NFT_TRANSFER routes through TRANSFER then directional pivot', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'COMPRESSED_NFT_TRANSFER',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [
          {
            mint: 'cnft-mint',
            tokenStandard: 'NonFungible',
            fromUserAccount: mockAddress,
            toUserAccount: 'someone-else',
            tokenAmount: 1,
            decimals: 0,
          },
        ],
        nativeTransfers: [],
      };
      const result = await transformTransaction(heliusTx, mockAddress);
      // TRANSFER + user is sender → SEND bucket
      expect(result.type).toBe(SEND);
    });

    test('should map STAKE_TOKEN to STAKE', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'STAKE_TOKEN',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);
      expect(result.type).toBe(STAKE);
    });

    test('should map UNKNOWN to UNKNOWN', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'UNKNOWN',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.type).toBe(UNKNOWN);
    });
  });

  describe('Status Mapping', () => {
    test('should mark transaction as completed when no error', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'TRANSFER',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.status).toBe('completed');
    });

    test('should mark transaction as failed when error exists', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'TRANSFER',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        transactionError: 'InsufficientFunds',
        tokenTransfers: [],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.status).toBe('failed');
    });
  });

  describe('NFT Metadata Reuse', () => {
    test('should reuse preloaded NFT metadata without additional DAS fetches', async () => {
      const heliusTx = {
        signature: 'nft-sig',
        type: 'TRANSFER',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: 'sender-address',
        tokenTransfers: [
          {
            fromUserAccount: 'sender-address',
            toUserAccount: mockAddress,
            tokenAmount: '1',
            mint: 'nft-mint',
            tokenStandard: 'NonFungible',
            decimals: 0,
          },
        ],
        nativeTransfers: [],
      };

      const nftMetadataByMint = new Map([
        ['nft-mint', { name: 'Cool NFT', symbol: 'CNFT', image: 'https://cdn.test/nft.png' }],
      ]);

      const result = await transformTransaction(heliusTx, mockAddress, [], { nftMetadataByMint });

      expect(getNftMetadataBatch).not.toHaveBeenCalled();
      expect(result.inputs[0]).toMatchObject({
        contract: 'nft-mint',
        isNft: true,
        name: 'Cool NFT',
        symbol: 'CNFT',
        logo: 'https://cdn.test/nft.png',
      });
    });
  });

  describe('Fee Extraction', () => {
    test('should include fee when user is fee payer', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'TRANSFER',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.fee).toBeDefined();
      expect(result.fee.amount).toBe(5000);
      expect(result.fee.decimals).toBe(9);
      expect(result.fee.symbol).toBe('SOL');
    });

    test('should not include fee when user is not fee payer', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'TRANSFER',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: 'other-address',
        tokenTransfers: [],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.fee).toBeUndefined();
    });
  });

  describe('Inputs/Outputs for SWAP', () => {
    test('should extract inputs and outputs for SWAP correctly', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'SWAP',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [
          // Output (user sends USDC)
          {
            fromUserAccount: mockAddress,
            toUserAccount: 'pool-address',
            tokenAmount: '1000000',
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            decimals: 6,
            symbol: 'USDC',
            name: 'USD Coin',
          },
          // Input (user receives SOL)
          {
            fromUserAccount: 'pool-address',
            toUserAccount: mockAddress,
            tokenAmount: '500000000',
            mint: 'So11111111111111111111111111111111111111112',
            decimals: 9,
            symbol: 'SOL',
            name: 'Solana',
          },
        ],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.type).toBe(SWAP);

      // Inputs: tokens the user received (resource convention)
      expect(result.inputs.length).toBe(1);
      expect(result.inputs[0].symbol).toBe('SOL');
      expect(result.inputs[0].amount).toBe('500000000');

      // Outputs: tokens the user sent (resource convention)
      expect(result.outputs.length).toBe(1);
      expect(result.outputs[0].symbol).toBe('USDC');
      expect(result.outputs[0].amount).toBe('1000000');
    });
  });

  describe('Inputs/Outputs for SEND', () => {
    test('should extract outputs for SEND correctly', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'TRANSFER',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        tokenTransfers: [
          {
            fromUserAccount: mockAddress,
            toUserAccount: 'recipient-address',
            tokenAmount: '1000000',
            mint: 'token-mint',
            decimals: 6,
            symbol: 'USDC',
          },
        ],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.type).toBe(SEND);
      expect(result.outputs.length).toBe(1);
      expect(result.outputs[0].symbol).toBe('USDC');
      expect(result.outputs[0].destination).toBe('recipient-address');
    });
  });

  describe('Inputs/Outputs for RECEIVE', () => {
    test('should extract inputs for RECEIVE correctly', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'TRANSFER',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: 'sender-address',
        tokenTransfers: [
          {
            fromUserAccount: 'sender-address',
            toUserAccount: mockAddress,
            tokenAmount: '2000000',
            mint: 'token-mint',
            decimals: 6,
            symbol: 'USDT',
          },
        ],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.type).toBe(RECEIVE);
      expect(result.inputs.length).toBe(1);
      expect(result.inputs[0].symbol).toBe('USDT');
      expect(result.inputs[0].source).toBe('sender-address');
    });
  });

  describe('Enriched Fields', () => {
    test('should include Helius enriched fields', async () => {
      const heliusTx = {
        signature: 'test-sig',
        type: 'SWAP',
        timestamp: 1234567890,
        fee: 5000,
        feePayer: mockAddress,
        description: 'Swapped 1 USDC for 0.5 SOL on Jupiter',
        source: 'JUPITER',
        events: [{ type: 'SWAP', data: {} }],
        tokenTransfers: [],
        nativeTransfers: [],
      };

      const result = await transformTransaction(heliusTx, mockAddress);

      expect(result.description).toBe('Swapped 1 USDC for 0.5 SOL on Jupiter');
      expect(result.source).toBe('JUPITER');
      expect(result.events).toBeDefined();
      expect(result.heliusType).toBe('SWAP');
    });
  });
});
