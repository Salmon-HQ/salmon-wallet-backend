'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

const http = require('axios');
const { getCallerGeo } = require('../geo-service');

describe('geo-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches ip-api.com and returns the payload', async () => {
    http.get.mockResolvedValue({ data: { country: 'AR', query: '1.2.3.4' } });

    const result = await getCallerGeo();

    expect(http.get).toHaveBeenCalledWith('http://ip-api.com/json', { timeout: 3000 });
    expect(result).toEqual({ country: 'AR', query: '1.2.3.4' });
  });

  it('propagates upstream errors', async () => {
    const err = new Error('boom');
    http.get.mockRejectedValue(err);

    await expect(getCallerGeo()).rejects.toThrow(err);
  });
});
