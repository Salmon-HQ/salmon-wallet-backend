'use strict';

jest.mock('../../data-source', () => ({
  redis: {
    exists: jest.fn(),
    sendCommand: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));
jest.mock('../../helper', () => ({
  getCacheKey: jest.fn((suffix) => `k:${suffix}`),
  getFromCache: jest.fn(),
  storeInCache: jest.fn().mockResolvedValue(undefined),
}));

const { redis } = require('../../data-source');
const { storeInCache } = require('../../helper');
const repository = require('../sanctions-repository');

describe('sanctions-repository', () => {
  beforeEach(() => jest.clearAllMocks());

  it('checks exact membership of the live set', async () => {
    redis.sendCommand.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(repository.isListedLocally('A')).resolves.toBe(true);
    await expect(repository.isListedLocally('B')).resolves.toBe(false);
    expect(redis.sendCommand).toHaveBeenCalledWith(['SISMEMBER', 'k:sanctions:addresses', 'A']);
  });

  it('replaces the list through :next and RENAME, in chunks, then stamps fetched_at', async () => {
    const addresses = Array.from({ length: 1001 }, (_, i) => `addr${i}`);
    await repository.replaceLocalList(addresses);

    expect(redis.del).toHaveBeenCalledWith(['k:sanctions:addresses:next']);
    const sadds = redis.sendCommand.mock.calls.filter(([args]) => args[0] === 'SADD');
    expect(sadds).toHaveLength(3);
    expect(sadds[0][0]).toHaveLength(502);
    expect(redis.sendCommand).toHaveBeenLastCalledWith([
      'RENAME',
      'k:sanctions:addresses:next',
      'k:sanctions:addresses',
    ]);
    expect(redis.set).toHaveBeenCalledWith('k:sanctions:fetched_at', expect.any(String));
  });

  it('caches a TRM verdict for 24 hours', async () => {
    await repository.saveTrmVerdict('A', true);
    expect(storeInCache).toHaveBeenCalledWith(
      'k:sanctions:trm:A',
      { isSanctioned: true, checkedAt: expect.any(String) },
      86400
    );
  });
});
