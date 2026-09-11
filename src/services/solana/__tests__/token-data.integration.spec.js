'use strict';

/**
 * Nightly: real Triton DAS + CoinGecko for the token-data path (spec 013).
 * Probe-skips without `TRITON_RPC_URL` / `COINGECKO_API_KEY`.
 */

const axios = require('axios');
const tritonClient = require('../../../infrastructure/triton-client');
const metadata = require('../token-metadata-service');
const catalog = require('../token-catalog-service');
const coingeckoService = require('../../shared/coingecko-service');
const { redis } = require('../../../repositories/data-source');

jest.setTimeout(60000);

afterAll(async () => {
  await redis.quit();
});

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BERN = 'CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo';
const SOL = 'So11111111111111111111111111111111111111112';
const locals = { network: { environment: 'mainnet' } };

describe('token data — integration', () => {
  let triton = false;
  let cg = false;

  beforeAll(async () => {
    triton = tritonClient.isConfigured('mainnet');
    if (!triton) console.warn('Skipping Triton DAS integration: TRITON_RPC_URL not set');
    if (process.env.COINGECKO_API_KEY) {
      try {
        const base = process.env.COINGECKO_API_URL || 'https://api.coingecko.com';
        await axios.get(`${base}/api/v3/ping`, {
          timeout: 5000,
          headers: {
            [base.includes('pro-api') ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']:
              process.env.COINGECKO_API_KEY,
          },
        });
        cg = true;
      } catch (error) {
        console.warn(`Skipping CoinGecko integration: ${error.message}`);
      }
    } else {
      console.warn('Skipping CoinGecko integration: COINGECKO_API_KEY not set');
    }
  });

  it('describes USDC and flags BERN as not swappable from DAS', async () => {
    if (!triton) return;
    const tokens = await metadata.getByMints([USDC, BERN, SOL], locals);
    expect(tokens.get(USDC)).toMatchObject({ symbol: 'USDC', decimals: 6, swappable: true });
    expect(tokens.get(BERN)).toMatchObject({ tokenProgram: 'token-2022', swappable: false });
    expect(tokens.get(SOL)).toEqual(metadata.NATIVE_SOL);
  });

  it('lists USDC as verified with its coin id and finds it by symbol', async () => {
    if (!cg) return;
    const verified = await catalog.getVerified();
    expect(verified.length).toBeGreaterThan(100);
    const usdc = verified.find((t) => t.id === USDC);
    expect(usdc).toMatchObject({ symbol: 'USDC', tags: ['verified'], coingeckoId: 'usd-coin' });
    const hits = await catalog.search('usdc');
    expect(hits[0].id).toBe(USDC);
  });

  it('prices USDC and SOL in USD with a 24h change, and leaves an unknown mint absent', async () => {
    if (!cg) return;
    const prices = await coingeckoService.getTokenPrices(
      [USDC, SOL, 'Unknown111111111111111111111111111111111111'],
      locals
    );
    expect(prices.get(USDC).usdPrice).toBeCloseTo(1, 1);
    expect(prices.get(SOL).usdPrice).toBeGreaterThan(0);
    expect(prices.has('Unknown111111111111111111111111111111111111')).toBe(false);
  });
});
