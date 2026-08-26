'use strict';

jest.mock('../../../../packages/api-utils', () => ({
  decorator: jest.fn(async (_resource, data) => data),
}));
jest.mock('../../../resources/solana/solana-transaction-resource', () =>
  jest.fn(async (data) => data)
);
jest.mock('../../../services/solana/solana-transaction-service');

const controller = require('../solana-account-controller');
const transactionService = require('../../../services/solana/solana-transaction-service');
const {
  clearTransactionHistoryCache,
} = require('../../../infrastructure/cache/transaction-history-cache');

// Configurar timeout
jest.setTimeout(30000);

describe('Solana Account Controller - E2E Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearTransactionHistoryCache();
  });

  describe('listTransactions()', () => {
    test('should return paginated transaction history from Helius', async () => {
      const mockTransactions = {
        data: [
          {
            address: 'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9',
            signature: 'sig-1',
            id: 'sig-1',
            timestamp: 1234567890,
            status: 'completed',
            type: 'swap',
            inputs: [],
            outputs: [],
            _source: 'enriched',
          },
          {
            address: 'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9',
            signature: 'sig-2',
            id: 'sig-2',
            timestamp: 1234567880,
            status: 'completed',
            type: 'send',
            inputs: [],
            outputs: [],
            _source: 'enriched',
          },
        ],
        meta: {
          nextPageToken: 'sig-2',
        },
      };

      transactionService.getTransactions.mockImplementation(async () =>
        JSON.parse(JSON.stringify(mockTransactions))
      );

      const req = {
        params: {
          address: 'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9',
        },
        query: {
          pageSize: '10',
        },
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
        locals: {
          network: {
            id: 'solana-mainnet',
            environment: 'mainnet',
            config: {},
          },
        },
      };

      await controller.listTransactions(req, res);

      expect(transactionService.getTransactions).toHaveBeenCalledWith(
        'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9',
        { pageSize: '10' },
        res.locals
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalled();

      const response = res.send.mock.calls[0][0];
      expect(response.data).toHaveLength(2);
      expect(response.meta.nextPageToken).toBe('sig-2');
    });

    test('should handle empty transaction history', async () => {
      const mockTransactions = {
        data: [],
        meta: {
          nextPageToken: undefined,
        },
      };

      transactionService.getTransactions.mockImplementation(async () =>
        JSON.parse(JSON.stringify(mockTransactions))
      );

      const req = {
        params: {
          address: 'FMDP1kzv5pjeMcAazqjqVpLL8hyrWG26oB9ozwx99CD',
        },
        query: {},
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
        locals: {
          network: {
            id: 'solana-mainnet',
            environment: 'mainnet',
            config: {},
          },
        },
      };

      await controller.listTransactions(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalled();

      const response = res.send.mock.calls[0][0];
      expect(response.data).toHaveLength(0);
    });

    test('should cache identical first-page requests', async () => {
      const mockTransactions = {
        data: [
          {
            address: 'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9',
            signature: 'sig-1',
            id: 'sig-1',
            timestamp: 1234567890,
            status: 'completed',
            type: 'swap',
            inputs: [],
            outputs: [],
            _source: 'enriched',
          },
        ],
        meta: {
          nextPageToken: 'sig-1',
        },
      };

      transactionService.getTransactions.mockImplementation(async () =>
        JSON.parse(JSON.stringify(mockTransactions))
      );

      const req = {
        params: {
          address: 'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9',
        },
        query: {
          pageSize: '10',
        },
      };

      const createRes = () => ({
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
        locals: {
          network: {
            id: 'solana-mainnet',
            environment: 'mainnet',
            config: {},
          },
        },
      });

      const res1 = createRes();
      const res2 = createRes();

      await controller.listTransactions(req, res1);
      await controller.listTransactions(req, res2);

      expect(transactionService.getTransactions).toHaveBeenCalledTimes(1);
      expect(res1.send).toHaveBeenCalledTimes(1);
      expect(res2.send).toHaveBeenCalledTimes(1);
      expect(res2.send.mock.calls[0][0]).toEqual(res1.send.mock.calls[0][0]);
    });

    test('should not cache paginated requests', async () => {
      const mockTransactions = {
        data: [
          {
            address: 'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9',
            signature: 'sig-2',
            id: 'sig-2',
            timestamp: 1234567880,
            status: 'completed',
            type: 'send',
            inputs: [],
            outputs: [],
            _source: 'enriched',
          },
        ],
        meta: {
          nextPageToken: 'sig-2',
        },
      };

      transactionService.getTransactions.mockImplementation(async () =>
        JSON.parse(JSON.stringify(mockTransactions))
      );

      const req = {
        params: {
          address: 'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9',
        },
        query: {
          pageSize: '10',
          pageToken: 'sig-1',
        },
      };

      const createRes = () => ({
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
        locals: {
          network: {
            id: 'solana-mainnet',
            environment: 'mainnet',
            config: {},
          },
        },
      });

      await controller.listTransactions(req, createRes());
      await controller.listTransactions(req, createRes());

      expect(transactionService.getTransactions).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    test('should handle service errors gracefully', async () => {
      transactionService.getTransactions.mockRejectedValue(new Error('Helius API Error'));

      const req = {
        params: {
          address: 'GrqhvnERtNP4Q97s5e2YiPC7zfUBtxQqk6knPa178Cs9',
        },
        query: {},
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
        locals: {
          network: {
            id: 'solana-mainnet',
            environment: 'mainnet',
            config: {},
          },
        },
      };

      await expect(controller.listTransactions(req, res)).rejects.toThrow('Helius API Error');
    });
  });
});
