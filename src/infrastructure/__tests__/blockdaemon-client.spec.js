'use strict';

const client = require('../blockdaemon-client');

describe('blockdaemon-client', () => {
  const locals = {
    network: {
      blockchain: 'bitcoin',
      environment: 'mainnet',
    },
  };

  const originalApiKey = process.env.UBIQUITY_API_KEY;

  afterEach(() => {
    process.env.UBIQUITY_API_KEY = originalApiKey;
  });

  it('builds universal Blockdaemon URLs from request locals', () => {
    expect(client.getUniversalUrl(locals, '/account/btc-address')).toBe(
      'https://svc.blockdaemon.com/universal/v1/bitcoin/mainnet/account/btc-address'
    );
  });

  it('builds request config with lazy API key reads', () => {
    process.env.UBIQUITY_API_KEY = 'first-key';

    expect(client.getRequestConfig({ timeout: 3000, params: { limit: 10 } })).toEqual({
      headers: { 'X-API-Key': 'first-key' },
      params: { limit: 10 },
      timeout: 3000,
    });

    process.env.UBIQUITY_API_KEY = 'second-key';

    expect(client.getHeaders()).toEqual({ 'X-API-Key': 'second-key' });
  });
});
