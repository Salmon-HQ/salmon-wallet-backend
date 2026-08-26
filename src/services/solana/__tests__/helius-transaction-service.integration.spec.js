'use strict';

const http = require('node:http');
const https = require('node:https');
const heliusService = require('../helius-transaction-service');

// Use a longer timeout for real-network requests
jest.setTimeout(30000);

// Force-close keep-alive sockets so Jest exits cleanly when integration
// requests leave connections open after assertions complete.
afterAll(() => {
  http.globalAgent.destroy();
  https.globalAgent.destroy();
});

// Probe the Enhanced API directly (not through the service under test, so a
// service regression can still fail the suite). Skips when the key is the
// jest.setup dummy (HTTP 401), missing, or the provider is unreachable —
// checking that the env var merely EXISTS is not a guard: jest.setup.js
// injects a dummy value that satisfies it.
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

describe('Helius Enhanced Transactions API - Integration Tests', () => {
  let heliusAvailable = false;

  beforeAll(async () => {
    const result = await probeHelius();
    heliusAvailable = result.ok;
    if (!heliusAvailable) {
      console.warn(`[helius-integration] Skipping: ${result.reason}`);
    }
  });

  describe('getEnhancedTransactions() - Single transaction', () => {
    test('should fetch and parse a Jupiter swap transaction', async () => {
      if (!heliusAvailable) return;
      // Signature de un swap real de Jupiter en mainnet (reciente)
      const signature =
        '42GYdSrtwmU6rHmGuC8KcWANa7w15ieZpZnjY39EQVR9oiDnbptFaTw7PLtfBeHPH27L9AzTVqpY51YsMVgYcDRY';

      const result = await heliusService.getEnhancedTransactions(signature, 'mainnet');

      // Verificar estructura de respuesta de Helius
      expect(result).not.toBeNull();
      expect(result.signature).toBe(signature);
      expect(result.type).toBeDefined(); // SWAP, TRANSFER, etc.
      expect(result.timestamp).toBeDefined();
      expect(result.fee).toBeDefined();
      expect(result.feePayer).toBeDefined();

      // Si es un swap, debe tener transfers de tokens
      if (result.type === 'SWAP') {
        expect(result.tokenTransfers).toBeDefined();
        expect(Array.isArray(result.tokenTransfers)).toBe(true);
      }

      console.log('Helius Enhanced Transaction:', {
        type: result.type,
        description: result.description,
        source: result.source,
        fee: result.fee,
        tokenTransfersCount: result.tokenTransfers?.length || 0,
        nativeTransfersCount: result.nativeTransfers?.length || 0,
      });
    });

    test('should fetch multiple transactions at once', async () => {
      if (!heliusAvailable) return;
      // Array de signatures reales (recientes)
      const signatures = [
        '42GYdSrtwmU6rHmGuC8KcWANa7w15ieZpZnjY39EQVR9oiDnbptFaTw7PLtfBeHPH27L9AzTVqpY51YsMVgYcDRY',
      ];

      const result = await heliusService.getEnhancedTransactions(signatures, 'mainnet');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      result.forEach((tx) => {
        expect(tx.signature).toBeDefined();
        expect(tx.type).toBeDefined();
        expect(tx.timestamp).toBeDefined();
      });
    });

    test('should handle invalid signature gracefully', async () => {
      if (!heliusAvailable) return;
      const invalidSignature =
        '1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111';

      await expect(
        heliusService.getEnhancedTransactions(invalidSignature, 'mainnet')
      ).rejects.toThrow();
    });
  });

  describe('getEnhancedTransactionHistory() - Transaction history', () => {
    test('should fetch transaction history for an address', async () => {
      if (!heliusAvailable) return;
      // Test address (known wallet with activity)
      const address = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

      const result = await heliusService.getEnhancedTransactionHistory(
        address,
        { limit: 5 },
        'mainnet'
      );

      expect(result).not.toBeNull();
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.meta).toBeDefined();
      expect(result.meta.nextPageToken).toBeDefined();

      // Verificar estructura de transacciones
      if (result.data.length > 0) {
        const firstTx = result.data[0];
        expect(firstTx.signature).toBeDefined();
        expect(firstTx.type).toBeDefined();
        expect(firstTx.timestamp).toBeDefined();

        console.log('Transaction History Sample:', {
          count: result.data.length,
          firstType: firstTx.type,
          firstTimestamp: firstTx.timestamp,
          nextPageToken: result.meta.nextPageToken,
        });
      }
    });

    test('should support pagination with before parameter', async () => {
      if (!heliusAvailable) return;
      const address = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

      // First page
      const page1 = await heliusService.getEnhancedTransactionHistory(
        address,
        { limit: 3 },
        'mainnet'
      );

      expect(page1.data.length).toBeGreaterThan(0);
      expect(page1.meta.nextPageToken).toBeDefined();

      // Second page via nextPageToken
      const page2 = await heliusService.getEnhancedTransactionHistory(
        address,
        { limit: 3, before: page1.meta.nextPageToken },
        'mainnet'
      );

      expect(page2.data.length).toBeGreaterThan(0);

      // Las signatures deben ser diferentes
      const page1Signatures = page1.data.map((tx) => tx.signature);
      const page2Signatures = page2.data.map((tx) => tx.signature);
      const overlap = page1Signatures.filter((sig) => page2Signatures.includes(sig));
      expect(overlap.length).toBe(0);
    });

    test('should support filtering by transaction type', async () => {
      if (!heliusAvailable) return;
      const address = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

      const result = await heliusService.getEnhancedTransactionHistory(
        address,
        { limit: 5, type: 'SWAP' },
        'mainnet'
      );

      expect(result.data).toBeDefined();

      // If results are present, all must match the requested type
      result.data.forEach((tx) => {
        expect(tx.type).toBe('SWAP');
      });
    });
  });
});
