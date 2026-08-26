'use strict';

process.env.JUPITER_API_KEY = process.env.JUPITER_API_KEY || 'test-jupiter-key';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

jest.mock('../../../infrastructure/rate-limiting/jupiter-rate-limiter', () => ({
  rateLimiter: {
    waitAndConsume: jest.fn().mockResolvedValue(undefined),
  },
  withRetry: jest.fn(async (operation) => operation()),
}));

const http = require('axios');
const {
  rateLimiter,
  withRetry,
} = require('../../../infrastructure/rate-limiting/jupiter-rate-limiter');
const service = require('../jupiter-token-service');

describe('jupiter-token-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rateLimiter.waitAndConsume.mockResolvedValue(undefined);
    withRetry.mockImplementation(async (operation) => operation());
  });

  it('returns empty list without calling Jupiter when no mint addresses are provided', async () => {
    await expect(service.getTokensByMints([])).resolves.toEqual([]);
    expect(rateLimiter.waitAndConsume).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  });

  it('limits mint lookups to the maximum supported query size', async () => {
    http.get.mockResolvedValue({
      data: [{ address: 'token-1' }],
    });

    const result = await service.getTokensByMints(
      Array.from({ length: 105 }, (_, index) => `mint-${index + 1}`)
    );

    expect(rateLimiter.waitAndConsume).toHaveBeenCalledTimes(1);
    expect(withRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        operationName: 'Jupiter Tokens V2 (100 mints)',
      })
    );
    expect(http.get).toHaveBeenCalledWith(
      expect.stringContaining('https://api.jup.ag/tokens/v2/search?query='),
      {
        timeout: 10000,
        headers: { 'x-api-key': process.env.JUPITER_API_KEY },
      }
    );
    expect(result).toEqual([{ address: 'token-1' }]);
  });

  it('returns verified tokens from the Jupiter tag endpoint', async () => {
    http.get.mockResolvedValue({
      data: [{ address: 'verified-1' }],
    });

    const result = await service.getVerifiedTokens();

    expect(http.get).toHaveBeenCalledWith('https://api.jup.ag/tokens/v2/tag?query=verified', {
      timeout: 10000,
      headers: { 'x-api-key': process.env.JUPITER_API_KEY },
    });
    expect(result).toEqual([{ address: 'verified-1' }]);
  });

  it('returns empty list for blank search queries', async () => {
    await expect(service.searchTokensByQuery('   ')).resolves.toEqual([]);
    expect(rateLimiter.waitAndConsume).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  });

  it('searches tokens using the trimmed query string', async () => {
    http.get.mockResolvedValue({
      data: [{ address: 'search-1' }],
    });

    const result = await service.searchTokensByQuery('  bonk  ');

    expect(http.get).toHaveBeenCalledWith('https://api.jup.ag/tokens/v2/search?query=bonk', {
      timeout: 10000,
      headers: { 'x-api-key': process.env.JUPITER_API_KEY },
    });
    expect(result).toEqual([{ address: 'search-1' }]);
  });
});
