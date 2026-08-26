'use strict';

jest.mock('axios', () => ({ get: jest.fn() }));

const http = require('axios');
const cdnTokenListService = require('../cdn-token-list-service');

describe('cdn-token-list-service.getVerifiedTokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normalizes SPL Token Registry entries to the Jupiter v2 canonical shape', async () => {
    http.get.mockResolvedValue({
      data: {
        tokens: [
          {
            address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            logoURI: 'https://example.test/usdc.png',
            tags: ['stablecoin'],
            extensions: { coingeckoId: 'usd-coin', website: 'https://circle.com' },
          },
        ],
      },
    });

    const result = await cdnTokenListService.getVerifiedTokens();

    expect(http.get).toHaveBeenCalledWith(
      cdnTokenListService.CDN_TOKEN_LIST_URL,
      expect.objectContaining({ timeout: 10000 })
    );
    expect(result).toEqual([
      {
        id: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        icon: 'https://example.test/usdc.png',
        tags: ['stablecoin'],
        coingeckoId: 'usd-coin',
      },
    ]);
  });

  test('preserves null coingeckoId when extensions does not provide one', async () => {
    http.get.mockResolvedValue({
      data: {
        tokens: [
          {
            address: 'NoCgMint11111111111111111111111111111111111',
            symbol: 'NCG',
            name: 'No CoinGecko',
            decimals: 9,
          },
        ],
      },
    });

    const [token] = await cdnTokenListService.getVerifiedTokens();
    expect(token.coingeckoId).toBeNull();
    expect(token.icon).toBeNull();
    expect(token.tags).toEqual([]);
  });

  test('drops malformed entries that miss address / symbol / name', async () => {
    http.get.mockResolvedValue({
      data: {
        tokens: [
          { address: 'A', symbol: 'A', name: 'A', decimals: 6 },
          { address: 'B', symbol: 'B', decimals: 6 }, // missing name
          { symbol: 'C', name: 'C', decimals: 6 }, // missing address
          { address: 'D', name: 'D', decimals: 6 }, // missing symbol
        ],
      },
    });

    const result = await cdnTokenListService.getVerifiedTokens();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('A');
  });

  test('returns empty array when payload is missing tokens', async () => {
    http.get.mockResolvedValue({ data: {} });
    expect(await cdnTokenListService.getVerifiedTokens()).toEqual([]);
  });

  test('propagates upstream errors', async () => {
    http.get.mockRejectedValue(new Error('cdn 503'));
    await expect(cdnTokenListService.getVerifiedTokens()).rejects.toThrow('cdn 503');
  });
});
