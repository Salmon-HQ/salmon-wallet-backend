'use strict';

jest.mock('axios');
jest.mock('../../../infrastructure/rate-limiting/helius-rate-limiter', () => ({
  withRetry: jest.fn(async (fn) => fn()),
  rateLimiter: { waitAndConsume: jest.fn().mockResolvedValue(undefined) },
}));

const http = require('axios');
const heliusService = require('../helius-transaction-service');

beforeEach(() => {
  jest.clearAllMocks();
});

// Pure-function coverage moved out of the integration spec so it runs in the
// PR gate (integration specs only run in the nightly workflow).
describe('helius-transaction-service (unit)', () => {
  describe('isTransactionParsed()', () => {
    test('should return true for parsed transactions', () => {
      const parsedTx = {
        signature: 'test',
        type: 'SWAP',
      };

      expect(heliusService.isTransactionParsed(parsedTx)).toBe(true);
    });

    test('should return false for UNKNOWN type transactions', () => {
      const unknownTx = {
        signature: 'test',
        type: 'UNKNOWN',
      };

      expect(heliusService.isTransactionParsed(unknownTx)).toBe(false);
    });

    test('should return false for transactions without type', () => {
      const noTypeTx = {
        signature: 'test',
      };

      expect(heliusService.isTransactionParsed(noTypeTx)).toBe(false);
    });
  });

  describe('getEnhancedTransactionHistory()', () => {
    test('builds nextPageToken from the last item signature', async () => {
      // Arrange
      http.get.mockResolvedValue({ data: [{ signature: 'sigA' }, { signature: 'sigB' }] });

      // Act
      const result = await heliusService.getEnhancedTransactionHistory('addr');

      // Assert
      expect(result.data).toHaveLength(2);
      expect(result.meta.nextPageToken).toBe('sigB');
    });

    test('returns empty data and no nextPageToken when Helius returns falsy', async () => {
      // Arrange
      http.get.mockResolvedValue({ data: null });

      // Act
      const result = await heliusService.getEnhancedTransactionHistory('addr');

      // Assert
      expect(result).toEqual({ data: [], meta: { nextPageToken: undefined } });
    });

    test('throws for environments unsupported by the Enhanced API', async () => {
      // Act + Assert
      await expect(
        heliusService.getEnhancedTransactionHistory('addr', {}, 'testnet')
      ).rejects.toThrow('Enhanced API not supported for environment: testnet');
      expect(http.get).not.toHaveBeenCalled();
    });
  });

  describe('getEnhancedTransactions()', () => {
    test('unwraps the response for a single signature', async () => {
      // Arrange
      http.post.mockResolvedValue({ data: [{ signature: 'sigA', type: 'SWAP' }] });

      // Act
      const result = await heliusService.getEnhancedTransactions('sigA');

      // Assert
      expect(result).toEqual({ signature: 'sigA', type: 'SWAP' });
    });

    test('returns the full array for an array of signatures', async () => {
      // Arrange
      const parsed = [{ signature: 'sigA' }, { signature: 'sigB' }];
      http.post.mockResolvedValue({ data: parsed });

      // Act
      const result = await heliusService.getEnhancedTransactions(['sigA', 'sigB']);

      // Assert
      expect(result).toEqual(parsed);
    });

    test('throws for environments unsupported by the Enhanced API', async () => {
      // Act + Assert
      await expect(heliusService.getEnhancedTransactions('sigA', 'testnet')).rejects.toThrow(
        'Enhanced API not supported for environment: testnet'
      );
      expect(http.post).not.toHaveBeenCalled();
    });
  });
});
