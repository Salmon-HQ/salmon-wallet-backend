'use strict';

const http = require('node:http');
const https = require('node:https');
const axios = require('axios');
const tritonClient = require('../../../infrastructure/triton-client');
const transactionService = require('../solana-transaction-service');

// Triton parser walks aggregator swap txs (large payloads) plus token-service
// cold cache + DAS enrichment per tx. Real-network sessions need a wide
// budget; 180s lets the slowest run pass and the typical run finishes in
// well under 30s.
jest.setTimeout(180000);

// Force-close any axios keep-alive sockets so Jest can exit cleanly when
// integration requests leave connections open after assertions complete.
afterAll(() => {
  http.globalAgent.destroy();
  https.globalAgent.destroy();
});

// Probe Triton with the configured URL (raw axios, not through the service
// under test): no URL or an auth failure skips, it never fails the suite.
const probeTriton = async () => {
  if (!tritonClient.isConfigured('mainnet')) {
    return { ok: false, reason: 'TRITON_RPC_URL not configured' };
  }
  try {
    const { data } = await axios.post(
      tritonClient.getRpcUrl('mainnet'),
      { jsonrpc: '2.0', id: 1, method: 'getSlot' },
      { timeout: 5000 }
    );
    return data.error ? { ok: false, reason: data.error.message } : { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error.response?.status ? `HTTP ${error.response.status}` : error.code,
    };
  }
};

describe('Solana Transaction Service - Integration Tests with Triton', () => {
  let tritonReachable = false;
  let mockLocals;

  beforeAll(async () => {
    const result = await probeTriton();
    tritonReachable = result.ok;
    if (!tritonReachable) {
      console.warn(`[solana-transaction-integration] Skipping: ${result.reason}`);
      return;
    }
    mockLocals = {
      network: {
        id: 'solana-mainnet',
        environment: 'mainnet',
        config: { nodeUrl: tritonClient.getRpcUrl('mainnet') },
      },
    };
  });

  describe('getTransactions() - enriched history from Triton + the local parser', () => {
    test('enriches the history without any second provider', async () => {
      if (!tritonReachable) return;

      // An aggregator address (heavy swap activity)
      const address = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

      const result = await transactionService.getTransactions(address, { pageSize: 5 }, mockLocals);

      expect(Array.isArray(result.data)).toBe(true);
      expect(result.meta.nextPageToken).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].signature).toBeDefined();
      expect(result.data.every((tx) => tx._source === 'enriched')).toBe(true);
    });

    test('should support pagination', async () => {
      if (!tritonReachable) return;

      const address = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

      const page1 = await transactionService.getTransactions(address, { pageSize: 3 }, mockLocals);

      expect(page1.data.length).toBeGreaterThan(0);
      expect(page1.meta.nextPageToken).toBeDefined();

      const page2 = await transactionService.getTransactions(
        address,
        { pageSize: 3, pageToken: page1.meta.nextPageToken },
        mockLocals
      );

      expect(page2.data.length).toBeGreaterThan(0);

      const page1Signatures = page1.data.map((tx) => tx.signature);
      const overlap = page2.data.filter((tx) => page1Signatures.includes(tx.signature));
      expect(overlap).toHaveLength(0);
    });

    test('should handle address with no transactions', async () => {
      if (!tritonReachable) return;

      const emptyAddress = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';

      const result = await transactionService.getTransactions(
        emptyAddress,
        { pageSize: 10 },
        mockLocals
      );

      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('Bare-RPC tier', () => {
    test('reads the configured RPC node when the environment has no enriched path', async () => {
      if (!tritonReachable) return;

      // 'testnet' is never Triton-hosted, so the service reads the bare RPC.
      // The nodeUrl points at mainnet so the wallet has history.
      const rpcOnlyLocals = {
        network: {
          id: 'solana-testnet',
          environment: 'testnet',
          config: { nodeUrl: tritonClient.getRpcUrl('mainnet') },
        },
      };

      const result = await transactionService.getTransactions(
        '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3',
        { pageSize: 1 },
        rpcOnlyLocals
      );

      expect(result.data[0]._source).toBe('rpc-standard');
    });
  });
});
