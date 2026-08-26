'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

jest.mock('../../../repositories/shared/scam-repository', () => ({
  getUrls: jest.fn(),
  saveUrls: jest.fn(),
}));

const http = require('axios');
const repository = require('../../../repositories/shared/scam-repository');
const service = require('../scam-service');

describe('scam-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty list for unsupported blockchain', async () => {
    const result = await service.listUrls('dogecoin', {});

    expect(result).toEqual([]);
    expect(repository.getUrls).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  });

  it('returns cached urls when present', async () => {
    repository.getUrls.mockResolvedValue(['cached.com']);

    const result = await service.listUrls('solana', {});

    expect(result).toEqual(['cached.com']);
    expect(http.get).not.toHaveBeenCalled();
    expect(repository.saveUrls).not.toHaveBeenCalled();
  });

  it('loads, normalizes and caches remote urls', async () => {
    repository.getUrls.mockResolvedValue(null);
    http.get.mockResolvedValue({
      data: `
- url: Example.COM
- url: Another.io
`,
    });

    const result = await service.listUrls('solana', { stage: 'test' });

    expect(result).toEqual(['example.com', 'another.io']);
    expect(repository.saveUrls).toHaveBeenCalledWith('solana', ['example.com', 'another.io'], {
      stage: 'test',
    });
  });
});
