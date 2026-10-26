'use strict';

const util = require('util');

const TOKEN = 'triton-secret-token-1234567890';

const loadNetworks = () => {
  let networks;
  jest.isolateModules(() => {
    networks = require('../networks');
  });
  return networks;
};

describe('network catalog', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = {
      ...env,
      TRITON_RPC_URL: `https://tenant.solana-mainnet.rpcpool.com/${TOKEN}`,
      TRITON_RPC_URL_DEVNET: `https://tenant.solana-devnet.rpcpool.com/${TOKEN}`,
    };
  });

  afterEach(() => {
    process.env = env;
  });

  it('keeps the Triton token out of every serialization of the catalog', () => {
    const networks = loadNetworks();

    expect(JSON.stringify(networks)).not.toContain(TOKEN);
    expect(util.inspect(networks, { depth: null })).not.toContain(TOKEN);
    expect(JSON.stringify(networks.map((network) => ({ ...network.config })))).not.toContain(TOKEN);
  });

  it('still hands the token-bearing URL to the code that reads nodeUrl', () => {
    const networks = loadNetworks();

    const mainnet = networks.find((network) => network.id === 'solana-mainnet');
    expect(mainnet.config.nodeUrl).toBe(`https://tenant.solana-mainnet.rpcpool.com/${TOKEN}`);
  });
});
