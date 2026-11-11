'use strict';

jest.mock('../../../services/solana/skr-staking-service', () => ({ getSkrStake: jest.fn() }));
jest.mock('../../../resources/solana/solana-skr-stake-resource', () => (x) => ({ decorated: x }));
jest.mock('../../../infrastructure/cache/cache-helper', () => ({
  withSingleFlight: jest.fn(),
  getCacheKeyFor: (entity, property, value) => `${entity}:${property}:${value}`,
}));

const { withSingleFlight } = require('../../../infrastructure/cache/cache-helper');
const skrService = require('../../../services/solana/skr-staking-service');
const controller = require('../solana-skr-controller');

const OWNER = '7cFTw7Y2nWmfSnHGQd3QScFrxbdp7hmK5k9iBXuA7iMy';
const createRes = () => {
  const res = { locals: { network: { id: 'solana-mainnet' } } };
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('solana-skr-controller getStake', () => {
  beforeEach(() => jest.clearAllMocks());

  it('serves the per-owner cache entry and rebuilds through the service on a miss', async () => {
    withSingleFlight.mockImplementation(async (key, { rebuild }) => {
      expect(key).toBe(`skr_stake:owner:${OWNER}`);
      return rebuild();
    });
    skrService.getSkrStake.mockResolvedValue({ mint: 'SKR' });
    const res = createRes();
    await controller.getStake({ query: { owner: OWNER } }, res);
    expect(withSingleFlight).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ ttl: 60, staleTtl: 600, lockMs: 10000 })
    );
    expect(res.send).toHaveBeenCalledWith({ decorated: { mint: 'SKR' } });
  });

  it('never reaches the cache for an invalid owner', async () => {
    const res = createRes();
    await controller.getStake({ query: { owner: 'nope' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(withSingleFlight).not.toHaveBeenCalled();
  });
});
