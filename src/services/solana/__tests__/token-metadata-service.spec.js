'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../../infrastructure/triton-client', () => ({
  getRpcUrl: jest.fn(() => 'https://triton.test'),
}));
jest.mock('../../../infrastructure/cache/cache-helper', () => ({
  getCacheKeyFor: jest.fn((e, p, v) => `${e}:${v}`),
  getFromCache: jest.fn(),
  storeInCache: jest.fn(),
}));

const axios = require('axios');
const cache = require('../../../infrastructure/cache/cache-helper');
const service = require('../token-metadata-service');

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const BERN = 'CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo';
const SOL = 'So11111111111111111111111111111111111111112';
const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Shapes recorded from our Triton endpoint on 2026-09-11.
const asset = (
  id,
  { symbol, name, decimals, program = SPL, image = 'https://img/x.png', extensions }
) => ({
  id,
  interface: 'FungibleToken',
  content: { metadata: { symbol, name }, links: { image } },
  token_info: { decimals, token_program: program },
  ...(extensions ? { mint_extensions: extensions } : {}),
});
const usdcAsset = asset(USDC, { symbol: 'USDC', name: 'USD Coin', decimals: 6 });
const pyusdAsset = asset(PYUSD, {
  symbol: 'PYUSD',
  name: 'PayPal USD',
  decimals: 6,
  program: T22,
  extensions: {
    transfer_hook: { authority: 'x', program_id: null },
    transfer_fee_config: {
      newer_transfer_fee: { epoch: 605, maximum_fee: 0, transfer_fee_basis_points: 0 },
    },
    permanent_delegate: { delegate: 'y' },
  },
});
const bernAsset = asset(BERN, {
  symbol: 'BERN',
  name: 'Bern',
  decimals: 5,
  program: T22,
  extensions: {
    transfer_fee_config: {
      newer_transfer_fee: { epoch: 698, maximum_fee: 1, transfer_fee_basis_points: 269 },
    },
  },
});

describe('token-metadata-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.getFromCache.mockResolvedValue(null);
  });

  it('maps DAS assets to the canonical token shape with the token program and swappability', async () => {
    axios.post.mockResolvedValue({ data: { result: [usdcAsset, pyusdAsset, bernAsset, null] } });

    const tokens = await service.getByMints([
      USDC,
      PYUSD,
      BERN,
      'Unknown111111111111111111111111111111111111',
    ]);

    expect(axios.post).toHaveBeenCalledWith(
      'https://triton.test',
      expect.objectContaining({
        method: 'getAssetBatch',
        params: { ids: expect.any(Array), displayOptions: { showFungible: true } },
      }),
      expect.any(Object)
    );
    expect(tokens.get(USDC)).toEqual({
      id: USDC,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      icon: 'https://img/x.png',
      tokenProgram: 'spl-token',
      swappable: true,
    });
    expect(tokens.get(PYUSD)).toMatchObject({ tokenProgram: 'token-2022', swappable: true });
    expect(tokens.get(BERN)).toMatchObject({ tokenProgram: 'token-2022', swappable: false });
    expect(tokens.has('Unknown111111111111111111111111111111111111')).toBe(false);
    expect(cache.storeInCache).toHaveBeenCalledTimes(3);
  });

  it('short-circuits native SOL and serves cached mints without a DAS call', async () => {
    cache.getFromCache.mockImplementation(async (key) =>
      key.endsWith(USDC) ? { id: USDC, symbol: 'USDC', decimals: 6 } : null
    );

    const tokens = await service.getByMints([SOL, USDC, SOL]);

    expect(axios.post).not.toHaveBeenCalled();
    expect(tokens.get(SOL)).toEqual(service.NATIVE_SOL);
    expect(tokens.get(USDC)).toMatchObject({ symbol: 'USDC' });
  });

  it('splits requests above the DAS batch limit', async () => {
    axios.post.mockResolvedValue({ data: { result: [] } });
    const mints = Array.from({ length: service.MAX_IDS_PER_BATCH + 1 }, (_, i) => `Mint${i}`);

    await service.getByMints(mints);

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[1][1].params.ids).toHaveLength(1);
  });

  it('surfaces a DAS error instead of answering an empty map', async () => {
    axios.post.mockResolvedValue({ data: { error: { code: -32602, message: 'bad ids' } } });

    await expect(service.getByMints([USDC])).rejects.toThrow('DAS getAssetBatch failed: bad ids');
  });

  describe('isSwappable', () => {
    it("applies 0x's Token-2022 rule", () => {
      expect(service.isSwappable(undefined)).toBe(true);
      expect(service.isSwappable({})).toBe(true);
      expect(service.isSwappable({ transfer_hook: { program_id: null } })).toBe(true);
      expect(service.isSwappable({ transfer_hook: { program_id: 'Hook111' } })).toBe(false);
      expect(
        service.isSwappable({
          transfer_fee_config: { older_transfer_fee: { transfer_fee_basis_points: 10 } },
        })
      ).toBe(false);
      expect(service.isSwappable({ non_transferable: {} })).toBe(false);
    });
  });
});
