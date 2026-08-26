'use strict';

/**
 * Triton provider integration tests against real wallets and live RPC.
 *
 * Skips automatically when:
 *   - TRITON_RPC_URL is not configured
 *   - Triton returns 403 (IP allowlist not satisfied for the dev machine)
 *
 * Wallets supplied by the user (mainnet, real activity):
 *   - 9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3
 *   - 7Q3Hm2QkDLJyy727sNc2AeH2vZxiPgWWXX6vTq8Ras6n
 *
 * Coverage:
 *   - getEnhancedTransactionHistory returns the canonical enriched shape
 *   - parser populates type / source / inputs+outputs the resource layer
 *     consumes
 *   - DAS getNftsByOwner / getNftMetadata responds via Triton when configured
 */

const http = require('node:http');
const https = require('node:https');

const TEST_WALLETS = [
  '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3',
  '7Q3Hm2QkDLJyy727sNc2AeH2vZxiPgWWXX6vTq8Ras6n',
];

jest.setTimeout(45000);

afterAll(() => {
  http.globalAgent.destroy();
  https.globalAgent.destroy();
});

const probeTriton = async () => {
  if (!process.env.TRITON_RPC_URL) return { ok: false, reason: 'TRITON_RPC_URL not configured' };
  const tritonClient = require('../../../../infrastructure/triton-client');
  const axios = require('axios');
  try {
    const url = tritonClient.getRpcUrl('mainnet');
    const { data } = await axios.post(
      url,
      { jsonrpc: '2.0', id: 'probe', method: 'getHealth' },
      { timeout: 5000 }
    );
    if (data?.error) return { ok: false, reason: `${data.error.code}: ${data.error.message}` };
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error.response?.status ? `HTTP ${error.response.status}` : error.message,
    };
  }
};

describe('Triton provider — integration', () => {
  let tritonAvailable = false;
  let skipReason = '';
  let provider;

  beforeAll(async () => {
    const result = await probeTriton();
    tritonAvailable = result.ok;
    skipReason = result.reason || '';
    if (tritonAvailable) {
      provider = require('../../providers/triton-provider');
    } else {
      console.warn(`[triton-integration] Skipping: ${skipReason}`);
    }
  });

  describe('getEnhancedTransactionHistory', () => {
    it.each(TEST_WALLETS)('returns canonical enriched shape for wallet %s', async (wallet) => {
      if (!tritonAvailable) {
        return;
      }

      const result = await provider.getEnhancedTransactionHistory(wallet, { limit: 5 }, 'mainnet');

      expect(result).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.meta).toBeDefined();

      if (result.data.length === 0) {
        // Wallet has no recent activity — still a valid response.
        return;
      }

      const tx = result.data[0];
      expect(tx.signature).toBeDefined();
      expect(typeof tx.timestamp).toBe('number');
      expect(typeof tx.fee).toBe('number');
      expect(tx.feePayer).toBeDefined();
      expect(typeof tx.type).toBe('string');
      expect(Array.isArray(tx.nativeTransfers)).toBe(true);
      expect(Array.isArray(tx.tokenTransfers)).toBe(true);
      expect(tx.heliusType).toBe(tx.type);

      // The 9 buckets the FE renders: SWAP, TRANSFER, TOKEN_MINT, NFT_MINT,
      // BURN, STAKE_TOKEN, COMPRESSED_NFT_*, UNKNOWN are valid; we just
      // assert it's a non-empty type string.
      expect(tx.type.length).toBeGreaterThan(0);

      // Pagination cursor is the last signature.
      if (result.data.length > 0) {
        expect(result.meta.nextPageToken).toBe(result.data[result.data.length - 1].signature);
      }
    });

    it('paginates first page (single-call) into second page (signature cursor) without overlap', async () => {
      if (!tritonAvailable) return;

      const page1 = await provider.getEnhancedTransactionHistory(
        TEST_WALLETS[0],
        { limit: 3 },
        'mainnet'
      );

      // Need a full first page to have a usable cursor + something to compare.
      if (page1.data.length < 3 || !page1.meta.nextPageToken) return;

      const page2 = await provider.getEnhancedTransactionHistory(
        TEST_WALLETS[0],
        { limit: 3, before: page1.meta.nextPageToken },
        'mainnet'
      );

      expect(Array.isArray(page2.data)).toBe(true);

      // The cursor is the last signature of page 1; page 2 must start strictly
      // after it — no signature should appear on both pages.
      const page1Sigs = new Set(page1.data.map((tx) => tx.signature));
      page2.data.forEach((tx) => {
        expect(page1Sigs.has(tx.signature)).toBe(false);
        expect(typeof tx.type).toBe('string');
        expect(tx.heliusType).toBe(tx.type);
      });
    });
  });

  describe('getEnhancedTransactions (single + batch)', () => {
    it('round-trips a single signature from history into single-tx fetch', async () => {
      if (!tritonAvailable) return;

      const history = await provider.getEnhancedTransactionHistory(
        TEST_WALLETS[0],
        { limit: 1 },
        'mainnet'
      );

      if (history.data.length === 0) return;

      const sig = history.data[0].signature;
      const single = await provider.getEnhancedTransactions(sig, 'mainnet');

      expect(single).not.toBeNull();
      expect(single.signature).toBe(sig);
      expect(single.type).toBeDefined();
    });

    it('batches multiple signatures preserving order', async () => {
      if (!tritonAvailable) return;

      const history = await provider.getEnhancedTransactionHistory(
        TEST_WALLETS[0],
        { limit: 3 },
        'mainnet'
      );

      if (history.data.length < 2) return;

      const signatures = history.data.map((tx) => tx.signature);
      const batch = await provider.getEnhancedTransactions(signatures, 'mainnet');

      expect(Array.isArray(batch)).toBe(true);
      expect(batch).toHaveLength(signatures.length);
      batch.forEach((tx, i) => {
        if (tx) {
          expect(tx.signature).toBe(signatures[i]);
        }
      });
    });
  });

  describe('DAS getNftsByOwner', () => {
    it.each(TEST_WALLETS)('returns paginated NFT shape for wallet %s', async (wallet) => {
      if (!tritonAvailable) return;

      const locals = {
        network: {
          environment: 'mainnet',
          config: {
            // The provider reads nodeUrl for Token-2022 enumeration; routing
            // it to Triton as well preserves single-provider semantics.
            nodeUrl: require('../../../../infrastructure/triton-client').getRpcUrl('mainnet'),
          },
        },
      };

      const result = await provider.getNftsByOwner(wallet, { limit: 10, offset: 0 }, locals);

      expect(result).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
      expect(typeof result.pagination.total).toBe('number');
    });
  });
});
