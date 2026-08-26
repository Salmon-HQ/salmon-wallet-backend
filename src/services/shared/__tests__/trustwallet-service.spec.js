'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

jest.mock('../../../repositories/shared/trustwallet-repository', () => ({
  getTokens: jest.fn(),
  saveTokens: jest.fn(),
}));

const http = require('axios');
const repository = require('../../../repositories/shared/trustwallet-repository');
const service = require('../trustwallet-service');

describe('trustwallet-service', () => {
  const locals = { network: { id: 'ethereum-mainnet', blockchain: 'ethereum' } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns cached tokens when the repository hits', async () => {
    const cached = [{ address: '0x1', symbol: 'USDC' }];
    repository.getTokens.mockResolvedValue(cached);

    const result = await service.listTokens('ethereum', locals);

    expect(repository.getTokens).toHaveBeenCalledWith('ethereum', locals);
    expect(http.get).not.toHaveBeenCalled();
    expect(repository.saveTokens).not.toHaveBeenCalled();
    expect(result).toBe(cached);
  });

  it('fetches upstream and writes to cache on cache miss', async () => {
    repository.getTokens.mockResolvedValue(null);
    const tokens = [{ address: '0x1', symbol: 'USDC' }];
    http.get.mockResolvedValue({ data: { tokens } });

    const result = await service.listTokens('ethereum', locals);

    expect(http.get).toHaveBeenCalledWith(
      'https://assets-cdn.trustwallet.com/blockchains/ethereum/tokenlist.json'
    );
    expect(repository.saveTokens).toHaveBeenCalledWith('ethereum', tokens, locals);
    expect(result).toBe(tokens);
  });

  it('builds the native logo URL deterministically without a network call', () => {
    const result = service.getNativeLogo('bitcoin');

    expect(result).toBe('https://assets-cdn.trustwallet.com/blockchains/bitcoin/info/logo.png');
    expect(http.get).not.toHaveBeenCalled();
  });
});
