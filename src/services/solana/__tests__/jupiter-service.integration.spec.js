'use strict';

const jupiterService = require('../jupiter-service');
const { redis } = require('../../../repositories/data-source');

// Use a longer timeout for real-network requests
jest.setTimeout(30000);

// Probe the Price API directly (not through the service under test, so a
// service regression can still fail the suite). Skips when the URL is the
// jest.setup dummy (`jupiter.test`, DNS failure) or the provider is
// unreachable — checking that the env var merely EXISTS is not a guard:
// jest.setup.js injects a dummy value that satisfies it.
const probeJupiterPrice = async () => {
  const axios = require('axios');
  try {
    const headers = process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {};
    await axios.get(
      `${process.env.JUPITER_PRICE_URL}?ids=So11111111111111111111111111111111111111112`,
      { timeout: 5000, headers }
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error.response?.status ? `HTTP ${error.response.status}` : error.message,
    };
  }
};

describe('Jupiter Price API v3 - Integration Tests', () => {
  let jupiterAvailable = false;

  beforeAll(async () => {
    const result = await probeJupiterPrice();
    jupiterAvailable = result.ok;
    if (!jupiterAvailable) {
      console.warn(`[jupiter-integration] Skipping: ${result.reason}`);
    }
  });

  afterAll(async () => {
    // Close the Redis connection so Jest can exit cleanly
    await redis.quit();
  });

  describe('price() - Real API calls', () => {
    test('should fetch SOL price successfully from v3 API', async () => {
      if (!jupiterAvailable) return;
      const solMint = 'So11111111111111111111111111111111111111112';
      const price = await jupiterService.price(solMint, 'USD');

      // Verify a valid price is returned
      expect(price).not.toBeNull();
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);

      console.log(`SOL price from v3 API: $${price}`);
    });

    test('should fetch USDC price successfully from v3 API', async () => {
      if (!jupiterAvailable) return;
      const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const price = await jupiterService.price(usdcMint, 'USD');

      // USDC should hover around $1
      expect(price).not.toBeNull();
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0.95);
      expect(price).toBeLessThan(1.05);

      console.log(`USDC price from v3 API: $${price}`);
    });

    test('should fetch JUP token price successfully from v3 API', async () => {
      if (!jupiterAvailable) return;
      const jupMint = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
      const price = await jupiterService.price(jupMint, 'USD');

      // JUP is a real token; should have a price
      expect(price).not.toBeNull();
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);

      console.log(`JUP token price from v3 API: $${price}`);
    });

    test('should return null for invalid/non-existent token', async () => {
      if (!jupiterAvailable) return;
      const invalidMint = '1111111111111111111111111111111111111111111';
      const price = await jupiterService.price(invalidMint, 'USD');

      // Invalid token should return null
      expect(price).toBeNull();
    });

    test('should return null for token without recent transactions', async () => {
      if (!jupiterAvailable) return;
      // Token unlikely to have transactions in the last 7 days
      const deadMint = 'TokenWithNoActivityIn7Days1111111111111111';
      const price = await jupiterService.price(deadMint, 'USD');

      expect(price).toBeNull();
    });

    test('should handle multiple tokens with cache', async () => {
      if (!jupiterAvailable) return;
      const solMint = 'So11111111111111111111111111111111111111112';
      const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      // Primera llamada - cache miss
      const solPrice1 = await jupiterService.price(solMint, 'USD');
      const usdcPrice1 = await jupiterService.price(usdcMint, 'USD');

      // Second call - should hit the cache
      const solPrice2 = await jupiterService.price(solMint, 'USD');
      const usdcPrice2 = await jupiterService.price(usdcMint, 'USD');

      // Prices should match (cache hit)
      expect(solPrice1).toBe(solPrice2);
      expect(usdcPrice1).toBe(usdcPrice2);

      expect(solPrice1).toBeGreaterThan(0);
      expect(usdcPrice1).toBeGreaterThan(0);

      console.log(`Cache test - SOL: $${solPrice1}, USDC: $${usdcPrice1}`);
    });

    test('should respect rate limiting without errors', async () => {
      if (!jupiterAvailable) return;
      const solMint = 'So11111111111111111111111111111111111111112';

      // Fire multiple quick calls
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(jupiterService.price(solMint, 'USD'));
      }

      const results = await Promise.all(promises);

      // All should complete without errors
      results.forEach((price) => {
        expect(price).not.toBeNull();
        expect(typeof price).toBe('number');
        expect(price).toBeGreaterThan(0);
      });

      console.log(`Rate limiting test passed - 5 requests completed`);
    });
  });
});
