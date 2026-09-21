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

  // Checked against the live endpoint: ip-api.com/json with no address
  // geolocates whatever TCP source it observes. Called from the Lambda that
  // is the Lambda's own egress address, so an address-less request answers
  // every caller with the service's location instead of their own.
  it('asks ip-api.com about the caller address, not about itself', async () => {
    http.get.mockResolvedValue({ data: { country: 'AR', query: '1.2.3.4' } });

    const result = await getCallerGeo('1.2.3.4');

    expect(http.get).toHaveBeenCalledWith('http://ip-api.com/json/1.2.3.4', { timeout: 3000 });
    expect(result).toEqual({ country: 'AR', query: '1.2.3.4' });
  });

  it('encodes the address so it cannot reshape the request path', async () => {
    http.get.mockResolvedValue({ data: {} });

    await getCallerGeo('1.2.3.4/../../evil?x=1');

    expect(http.get).toHaveBeenCalledWith(
      'http://ip-api.com/json/1.2.3.4%2F..%2F..%2Fevil%3Fx%3D1',
      { timeout: 3000 }
    );
  });

  it('falls back to the address-less form when the caller IP is unknown', async () => {
    http.get.mockResolvedValue({ data: {} });

    await getCallerGeo(undefined);

    expect(http.get).toHaveBeenCalledWith('http://ip-api.com/json', { timeout: 3000 });
  });

  it('propagates upstream errors', async () => {
    const err = new Error('boom');
    http.get.mockRejectedValue(err);

    await expect(getCallerGeo()).rejects.toThrow(err);
  });
});
