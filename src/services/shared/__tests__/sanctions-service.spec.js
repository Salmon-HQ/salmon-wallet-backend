'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../../repositories/shared/sanctions-repository', () => ({
  getTrmVerdict: jest.fn(),
  saveTrmVerdict: jest.fn().mockResolvedValue(undefined),
  hasLocalList: jest.fn(),
  isListedLocally: jest.fn(),
  getFetchedAt: jest.fn(),
}));
jest.mock('../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((name, fn) => fn({ timeout: 5000, signal: undefined })),
}));

const http = require('axios');
const repository = require('../../../repositories/shared/sanctions-repository');
const { providerCall } = require('../../../infrastructure/providers/provider-client');
const { isListed, SanctionsUnavailableError, TRM_ENDPOINT } = require('../sanctions-service');

const ADDRESS = '42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi';

describe('sanctions-service', () => {
  let logs;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TRM_API_KEY;
    logs = ['error', 'warn'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    repository.hasLocalList.mockResolvedValue(true);
    repository.getFetchedAt.mockResolvedValue(new Date().toISOString());
    repository.isListedLocally.mockResolvedValue(false);
    repository.getTrmVerdict.mockResolvedValue(null);
    http.post.mockResolvedValue({ data: [{ address: ADDRESS, isSanctioned: false }] });
  });

  afterEach(() => logs.forEach((l) => l.mockRestore()));

  it('lists an address on the local SDN copy without asking TRM', async () => {
    repository.isListedLocally.mockResolvedValue(true);
    await expect(isListed(ADDRESS)).resolves.toBe(true);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('lists an address TRM flags even when the local copy does not', async () => {
    http.post.mockResolvedValue({ data: [{ address: ADDRESS, isSanctioned: true }] });
    await expect(isListed(ADDRESS)).resolves.toBe(true);
    expect(providerCall).toHaveBeenCalledWith('trm', expect.any(Function), expect.any(Object));
    expect(http.post).toHaveBeenCalledWith(
      TRM_ENDPOINT,
      [{ address: ADDRESS }],
      expect.objectContaining({ headers: { 'content-type': 'application/json' } })
    );
    expect(repository.saveTrmVerdict).toHaveBeenCalledWith(ADDRESS, true);
  });

  it('sends the TRM key when configured and reuses a cached verdict', async () => {
    process.env.TRM_API_KEY = 'k';
    await isListed(ADDRESS);
    expect(http.post.mock.calls[0][2].headers['TRM-API-Key']).toBe('k');

    http.post.mockClear();
    repository.getTrmVerdict.mockResolvedValue({ isSanctioned: true, checkedAt: 'x' });
    await expect(isListed(ADDRESS)).resolves.toBe(true);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('answers from the local copy alone when TRM fails', async () => {
    http.post.mockRejectedValue(new Error('boom'));
    await expect(isListed(ADDRESS)).resolves.toBe(false);
  });

  it('answers from TRM alone when the local copy is missing, and logs it', async () => {
    repository.hasLocalList.mockResolvedValue(false);
    await expect(isListed(ADDRESS)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith('[SANCTIONS_LOCAL_MISSING]');
  });

  it('throws 503 upstream_unavailable when neither layer answers', async () => {
    repository.isListedLocally.mockRejectedValue(new Error('redis down'));
    http.post.mockRejectedValue(new Error('boom'));
    await expect(isListed(ADDRESS)).rejects.toBeInstanceOf(SanctionsUnavailableError);
    await expect(isListed(ADDRESS)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'upstream_unavailable',
    });
  });

  it('logs [SANCTIONS_STALE] when the copy is older than 48 hours', async () => {
    repository.getFetchedAt.mockResolvedValue(
      new Date(Date.now() - 49 * 3600 * 1000).toISOString()
    );
    await isListed(ADDRESS);
    expect(console.error).toHaveBeenCalledWith('[SANCTIONS_STALE]', expect.any(Object));
  });

  it('never logs the address', async () => {
    repository.isListedLocally.mockRejectedValue(new Error('redis down'));
    http.post.mockRejectedValue(new Error('boom'));
    await isListed(ADDRESS).catch(() => {});
    const all = logs.flatMap((l) => l.mock.calls);
    expect(JSON.stringify(all)).not.toContain(ADDRESS);
  });
});
