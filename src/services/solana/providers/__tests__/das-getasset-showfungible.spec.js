'use strict';

/**
 * The burn and transfer routes refuse to build an NFT transaction for a
 * fungible mint, and `isFungibleToken` decides that from `token_info.decimals`
 * — the interface allow-list cannot, because Triton reports USDC as `Custom`
 * with a non-zero `supply.edition_nonce` (checked against the live indexer).
 *
 * `decimals` exists only if the DAS response carries `token_info`, so both
 * single-asset calls must ask for that block. Both indexers include it by
 * default today, which means a regression here would be silent: the guard
 * would keep passing every test while quietly losing its only working arm.
 */

jest.mock('axios');
jest.mock('../../parser/triton-rpc');
jest.mock('../../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((_name, run) => run({ timeout: 10000, signal: undefined })),
}));

const axios = require('axios');
const tritonProvider = require('../triton-provider');
const heliusProvider = require('../helius-provider');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRITON_RPC_URL = 'https://triton.example/token';
  axios.post.mockResolvedValue({ data: { result: { id: 'mint-1' } } });
});

const bodyOf = () => axios.post.mock.calls[0][1];

describe('single-asset DAS getAsset requests the token_info block', () => {
  it('triton getNftByMint sends displayOptions.showFungible', async () => {
    await tritonProvider.getNftByMint('mint-1', { network: { environment: 'mainnet' } });

    expect(bodyOf()).toMatchObject({
      method: 'getAsset',
      params: { id: 'mint-1', displayOptions: { showFungible: true } },
    });
  });

  it('helius getNftByMint sends displayOptions.showFungible', async () => {
    await heliusProvider.getNftByMint('mint-1', {
      network: { environment: 'mainnet', config: { nodeUrl: 'https://helius.example' } },
    });

    expect(bodyOf()).toMatchObject({
      method: 'getAsset',
      params: { id: 'mint-1', displayOptions: { showFungible: true } },
    });
  });
});
