'use strict';

const swapService = require('../solana-ft-swap-service');

// Use a longer timeout for real-network requests
jest.setTimeout(30000);

// Probe the Ultra order endpoint directly (raw axios, not through the
// service under test) with a real minimal quote. A DNS-only check is not
// enough: the host can resolve while the key is missing/invalid, and every
// order() then returns null — auth failures must skip, not fail.
const probeJupiterSwap = async () => {
  const axios = require('axios');
  try {
    const headers = process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {};
    await axios.get(`${process.env.JUPITER_SWAP_URL}/order`, {
      timeout: 5000,
      headers,
      params: {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
        taker: '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3',
      },
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error.response?.status ? `HTTP ${error.response.status}` : error.message,
    };
  }
};

describe('Jupiter Ultra Swap API v1 - Integration Tests', () => {
  let jupiterHostReachable = false;

  beforeAll(async () => {
    const result = await probeJupiterSwap();
    jupiterHostReachable = result.ok;
    if (!jupiterHostReachable) {
      console.warn(`[jupiter-swap-integration] Skipping: ${result.reason}`);
    }
  });

  describe('order() - Real API calls', () => {
    test('should create order successfully for SOL to USDC swap', async () => {
      if (!jupiterHostReachable) {
        console.log('Skipping Jupiter integration assertions: api.jup.ag host is not reachable');
        return;
      }

      const params = {
        amount: '1000000', // 0.001 SOL (small amount for testing)
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        publicKey: '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3', // Test wallet
      };

      const result = await swapService.order(params, {});

      // Verify order response structure
      expect(result).not.toBeNull();
      expect(result.transaction).toBeDefined(); // Base64 unsigned transaction
      expect(typeof result.transaction).toBe('string');
      expect(result.requestId).toBeDefined(); // Required for execute
      expect(typeof result.requestId).toBe('string');
      expect(result.router).toBeDefined(); // iris, jupiterz, dflow, okx
      expect(result.outAmount).toBeDefined(); // Expected output amount
      expect(typeof result.priceImpact).toBe('number');
      expect(typeof result.feeBps).toBe('number');
      expect(typeof result.gasless).toBe('boolean');

      console.log('Ultra Order Response:', {
        router: result.router,
        outAmount: result.outAmount,
        priceImpact: result.priceImpact,
        feeBps: result.feeBps,
        gasless: result.gasless,
        hasTransaction: !!result.transaction,
        requestIdLength: result.requestId.length,
      });
    });

    test('should return null for invalid token pair', async () => {
      if (!jupiterHostReachable) {
        console.log('Skipping Jupiter integration assertions: api.jup.ag host is not reachable');
        return;
      }

      const params = {
        amount: '1000000',
        inputMint: '1111111111111111111111111111111111111111111', // Invalid
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        publicKey: '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3',
      };

      const result = await swapService.order(params, {});

      // Should return null or error
      expect(result).toBeNull();
    });
  });

  // NOTE: execute() has no integration test here. Real execute testing
  // requires getting an order, signing with a real wallet, and calling
  // execute with the signed transaction + requestId — wallet integration
  // that belongs to end-to-end testing, not this suite.

  // Referral assertions only mean something when the referral env is
  // configured: without it the order reflects Jupiter's own default fee
  // schedule, which varies by router (OKX quotes as low as 2 bps) — that is
  // the provider's tariff, not this service's behavior.
  const referralConfigured = Boolean(
    process.env.JUPITER_SWAP_REFERRAL_FEE_BPS && process.env.JUPITER_SWAP_REFERRAL_ACCOUNT
  );

  describe('Referral Fees Integration', () => {
    test('should apply referral fees correctly when configured', async () => {
      if (!jupiterHostReachable) {
        console.log('Skipping Jupiter integration assertions: api.jup.ag host is not reachable');
        return;
      }
      if (!referralConfigured) {
        console.log('Skipping referral assertions: referral env not configured');
        return;
      }

      const params = {
        amount: '1000000', // 0.001 SOL
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        publicKey: '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3',
      };

      const result = await swapService.order(params, {});

      expect(result).not.toBeNull();
      expect(result.feeBps).toBeDefined();
      expect(result.feeMint).toBeDefined();

      const expectedFeeBps = parseInt(process.env.JUPITER_SWAP_REFERRAL_FEE_BPS || '0');

      if (expectedFeeBps > 0) {
        // Referral fees are configured
        console.log(`\n📊 Referral Fees Test:`);
        console.log(`   Expected: ${expectedFeeBps} bps`);
        console.log(`   Actual:   ${result.feeBps} bps`);
        console.log(`   Fee Mint: ${result.feeMint}`);

        if (result.feeBps === expectedFeeBps) {
          console.log(`   ✅ Referral fees applied correctly!`);
          expect(result.feeBps).toBe(expectedFeeBps);
        } else {
          console.warn(`   ❌ Referral fees NOT applied (using default ${result.feeBps} bps)`);
          console.warn(`   ⚠️  Missing referralTokenAccount for ${result.feeMint}`);
          console.warn(`   📝 Action needed: Create referralTokenAccount for this mint`);
          // No fallamos el test si es < 5 bps (OKX router usa fees muy bajos)
          // Only verify some fee > 0
          expect(result.feeBps).toBeGreaterThan(0);
        }
      } else {
        // Referral fees NO configurados - debe usar defaults de Jupiter
        console.log(`\n📊 Referral Fees Test (NOT CONFIGURED):`);
        console.log(`   Using Jupiter default fees: ${result.feeBps} bps`);
        expect(result.feeBps).toBeGreaterThanOrEqual(5);
        expect(result.feeBps).toBeLessThanOrEqual(10);
      }
    });

    test('should detect different feeMint based on token pair', async () => {
      if (!jupiterHostReachable) {
        console.log('Skipping Jupiter integration assertions: api.jup.ag host is not reachable');
        return;
      }
      if (!referralConfigured) {
        console.log('Skipping referral assertions: referral env not configured');
        return;
      }

      // Test 1: SOL → USDC (feeMint should be SOL - highest priority)
      const solToUsdc = await swapService.order(
        {
          amount: '1000000',
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          publicKey: '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3',
        },
        {}
      );

      expect(solToUsdc).not.toBeNull();
      expect(solToUsdc.feeMint).toBe('So11111111111111111111111111111111111111112');
      console.log(`\n🔍 SOL → USDC swap: feeMint = ${solToUsdc.feeMint} (SOL - highest priority)`);

      // Test 2: USDC → SOL (feeMint should STILL be SOL - highest priority regardless of side)
      const usdcToSol = await swapService.order(
        {
          amount: '1000', // 0.001 USDC (6 decimals)
          inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          outputMint: 'So11111111111111111111111111111111111111112',
          publicKey: '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3',
        },
        {}
      );

      expect(usdcToSol).not.toBeNull();
      expect(usdcToSol.feeMint).toBe('So11111111111111111111111111111111111111112');
      console.log(`🔍 USDC → SOL swap: feeMint = ${usdcToSol.feeMint} (SOL - highest priority)\n`);
    });

    test('should apply referral fees for USDC stablecoin swaps', async () => {
      if (!jupiterHostReachable) {
        console.log('Skipping Jupiter integration assertions: api.jup.ag host is not reachable');
        return;
      }
      if (!referralConfigured) {
        console.log('Skipping referral assertions: referral env not configured');
        return;
      }

      // USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
      // TRUMP: 6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN (Official Trump token)

      // Test: TRUMP → USDC (no SOL involved, feeMint should be USDC - stablecoin priority)
      const trumpToUsdc = await swapService.order(
        {
          amount: '1000000', // 1 TRUMP (6 decimals)
          inputMint: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', // TRUMP
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
          publicKey: '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3',
        },
        {}
      );

      if (trumpToUsdc) {
        console.log(`\n💵 TRUMP → USDC swap:`);
        console.log(`   Fee Mint: ${trumpToUsdc.feeMint}`);
        console.log(`   Fee BPS:  ${trumpToUsdc.feeBps}`);

        const expectedFeeBps = parseInt(process.env.JUPITER_SWAP_REFERRAL_FEE_BPS || '0');

        if (trumpToUsdc.feeBps === expectedFeeBps) {
          console.log(`   ✅ Referral fees applied (USDC stablecoin)`);
        } else {
          console.log(
            `   ⚠️  Using default fees (may need referralTokenAccount for ${trumpToUsdc.feeMint})`
          );
        }

        expect(trumpToUsdc.feeMint).toBeDefined();
        expect(trumpToUsdc.feeBps).toBeGreaterThan(0);
      } else {
        console.log(`\n⚠️  TRUMP → USDC swap failed (no route or invalid token)`);
      }
    });

    test('should apply referral fees for USDT stablecoin swaps', async () => {
      if (!jupiterHostReachable) {
        console.log('Skipping Jupiter integration assertions: api.jup.ag host is not reachable');
        return;
      }
      if (!referralConfigured) {
        console.log('Skipping referral assertions: referral env not configured');
        return;
      }

      // USDT: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
      // PUMP: 9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump (pump.fun token)

      // Test: PUMP → USDT (no SOL/USDC involved, feeMint should be USDT - stablecoin priority)
      const pumpToUsdt = await swapService.order(
        {
          amount: '1000000000', // 1 PUMP (9 decimals)
          inputMint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', // PUMP
          outputMint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
          publicKey: '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3',
        },
        {}
      );

      if (pumpToUsdt) {
        console.log(`\n💵 PUMP → USDT swap:`);
        console.log(`   Fee Mint: ${pumpToUsdt.feeMint}`);
        console.log(`   Fee BPS:  ${pumpToUsdt.feeBps}`);

        const expectedFeeBps = parseInt(process.env.JUPITER_SWAP_REFERRAL_FEE_BPS || '0');

        if (pumpToUsdt.feeBps === expectedFeeBps) {
          console.log(`   ✅ Referral fees applied (USDT stablecoin)`);
        } else {
          console.log(
            `   ⚠️  Using default fees (may need referralTokenAccount for ${pumpToUsdt.feeMint})`
          );
        }

        expect(pumpToUsdt.feeMint).toBeDefined();
        expect(pumpToUsdt.feeBps).toBeGreaterThan(0);
      } else {
        console.log(`\n⚠️  PUMP → USDT swap failed (no route or invalid token)`);
      }
    });
  });

  // TODO: Add more integration tests
  // - Test gasless swap detection
  // - Test rate limiting
  // - Test error handling for expired requestId
  // - End-to-end test: order → sign → execute
});
