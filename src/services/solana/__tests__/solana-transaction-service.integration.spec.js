'use strict';

const http = require('node:http');
const https = require('node:https');
const transactionService = require('../solana-transaction-service');

// Triton parser walks Jupiter txs (large payloads) plus token-service
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

// Probe the Enhanced API with the configured key (raw axios, not through
// the service under test). A DNS-only check is not enough: the host
// resolves fine while the jest.setup dummy key 401s on every call — auth
// failures must skip, not fail.
const probeHelius = async () => {
  const heliusClient = require('../../../infrastructure/helius-client');
  const axios = require('axios');
  try {
    const url = heliusClient.buildEnhancedApiUrl(
      'mainnet',
      '/v0/addresses/JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4/transactions?limit=1'
    );
    if (!url) return { ok: false, reason: 'enhanced API not configured' };
    await axios.get(url, { timeout: 5000 });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error.response?.status ? `HTTP ${error.response.status}` : error.message,
    };
  }
};

describe('Solana Transaction Service - Integration Tests with Helius', () => {
  let heliusHostReachable = false;

  const mockLocals = {
    network: {
      id: 'solana-mainnet',
      environment: 'mainnet',
      config: {
        nodeUrl: process.env.HELIUS_API_KEY
          ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
          : 'https://api.mainnet-beta.solana.com',
      },
    },
  };

  beforeAll(async () => {
    const result = await probeHelius();
    heliusHostReachable = result.ok;
    if (!heliusHostReachable) {
      console.warn(`[solana-transaction-integration] Skipping: ${result.reason}`);
    }
  });

  describe('getTransactions() - Transaction history with Helius Enhanced API', () => {
    test('should fetch transaction history using Helius', async () => {
      if (!heliusHostReachable) {
        console.log(
          'Skipping Helius integration assertions: api-mainnet.helius-rpc.com is not reachable'
        );
        return;
      }

      // Usar address de Jupiter (conocida con mucha actividad de swaps)
      const address = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
      const filters = { pageSize: 5 };

      const result = await transactionService.getTransactions(address, filters, mockLocals);

      expect(result).not.toBeNull();
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.meta).toBeDefined();
      expect(result.meta.nextPageToken).toBeDefined();

      // Verificar estructura de transacciones
      if (result.data.length > 0) {
        const firstTx = result.data[0];
        expect(firstTx.address).toBe(address);
        expect(firstTx.signature).toBeDefined();
        expect(firstTx._source).toBeDefined();

        // Count how many came from Helius vs RPC
        const heliusCount = result.data.filter((tx) => tx._source === 'enriched').length;
        const rpcCount = result.data.filter((tx) => tx._source === 'rpc-standard').length;

        console.log('Transaction History Stats:', {
          total: result.data.length,
          fromHelius: heliusCount,
          fromRPC: rpcCount,
          nextPageToken: result.meta.nextPageToken?.substring(0, 20) + '...',
        });

        // Most should come from Helius when the provider is healthy
        expect(heliusCount).toBeGreaterThan(0);
      }
    });

    test('should support pagination', async () => {
      if (!heliusHostReachable) {
        console.log(
          'Skipping Helius integration assertions: api-mainnet.helius-rpc.com is not reachable'
        );
        return;
      }

      const address = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

      // First page
      const page1 = await transactionService.getTransactions(address, { pageSize: 3 }, mockLocals);

      expect(page1.data.length).toBeGreaterThan(0);
      expect(page1.meta.nextPageToken).toBeDefined();

      // Second page
      const page2 = await transactionService.getTransactions(
        address,
        { pageSize: 3, pageToken: page1.meta.nextPageToken },
        mockLocals
      );

      expect(page2.data.length).toBeGreaterThan(0);

      // Las signatures deben ser diferentes
      const page1Signatures = page1.data.map((tx) => tx.signature);
      const page2Signatures = page2.data.map((tx) => tx.signature);
      const overlap = page1Signatures.filter((sig) => page2Signatures.includes(sig));
      expect(overlap.length).toBe(0);
    });

    test('should handle address with no transactions', async () => {
      if (!heliusHostReachable) {
        console.log(
          'Skipping Helius integration assertions: api-mainnet.helius-rpc.com is not reachable'
        );
        return;
      }

      // Address nueva sin actividad (generada aleatoriamente)
      const emptyAddress = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';

      const result = await transactionService.getTransactions(
        emptyAddress,
        { pageSize: 10 },
        mockLocals
      );

      expect(result).not.toBeNull();
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      // May be an empty array
      expect(result.data.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Fallback Behavior', () => {
    test('should use the configured RPC node when enhanced API is disabled for the network', async () => {
      if (!heliusHostReachable) {
        console.log(
          'Skipping Helius fallback assertions: api-mainnet.helius-rpc.com is not reachable'
        );
        return;
      }

      // 'testnet' is a real environment the Enhanced API does not support
      // (mainnet/devnet only), so the service must fall back to the
      // configured RPC node. A fabricated environment would break token
      // enrichment instead: spl-token-registry only accepts real cluster
      // slugs. The nodeUrl points at mainnet so the wallet has history.
      const rpcOnlyLocals = {
        network: {
          id: 'solana-testnet',
          environment: 'testnet',
          config: {
            nodeUrl: 'https://api.mainnet-beta.solana.com', // Public RPC
          },
        },
      };

      const address = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';

      const result = await transactionService.getTransactions(
        address,
        { pageSize: 1 },
        rpcOnlyLocals
      );

      expect(result).not.toBeNull();
      expect(result.data[0]._source).toBe('rpc-standard');

      console.log('Configured RPC path confirmed:', result.data[0]._source);
    });
  });
});
