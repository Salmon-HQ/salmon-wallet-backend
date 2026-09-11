'use strict';

jest.mock('../../../../packages/api-utils', () => ({
  decorator: jest.fn(async (_resource, data) => data),
}));
jest.mock('../../../services/solana/solana-ft-service', () => ({
  getByMints: jest.fn(),
  getVerified: jest.fn(),
  search: jest.fn(),
  MAX_MINTS_PER_QUERY: 2,
}));
jest.mock('../../../services/solana/swap/solana-swap-build-service', () => ({
  build: jest.fn(),
  resolveAmount: jest.fn(),
  resolveSlippage: jest.fn(),
}));
jest.mock('../../../resources/solana/solana-swap-build-resource', () => 'swap-build-resource');
jest.mock('../../../services/solana/powerups/powerup-catalog-service', () => ({
  isOffered: jest.fn(() => true),
}));
const controller = require('../solana-ft-controller');
const swapBuildService = require('../../../services/solana/swap/solana-swap-build-service');
const tokenService = require('../../../services/solana/solana-ft-service');
const powerupCatalog = require('../../../services/solana/powerups/powerup-catalog-service');

const createRes = () => ({
  locals: {
    network: {
      id: 'solana-mainnet',
      environment: 'mainnet',
    },
  },
  status: jest.fn().mockReturnThis(),
  send: jest.fn(),
  json: jest.fn(),
});

describe('solana-ft-controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates verified token reads to solana-ft-service', async () => {
    const tokens = [{ address: 'verified-1', decimals: 6 }];
    tokenService.getVerified.mockResolvedValue(tokens);
    const res = createRes();

    await controller.verified({ query: {} }, res);

    expect(tokenService.getVerified).toHaveBeenCalledWith(res.locals);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(tokens);
  });

  it('delegates search to solana-ft-service and keeps query validation in controller', async () => {
    const missingRes = createRes();
    await controller.search({ query: {} }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(400);
    expect(missingRes.json).toHaveBeenCalledWith({
      error: 'missing_parameter',
      error_description: 'Query parameter "query" is required',
    });

    const tokens = [{ address: 'search-1', decimals: 6 }];
    tokenService.search.mockResolvedValue(tokens);
    const res = createRes();

    await controller.search({ query: { query: 'sol' } }, res);

    expect(tokenService.search).toHaveBeenCalledWith('sol', res.locals);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(tokens);
  });

  describe('build', () => {
    const TAKER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
    const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const SOL = 'So11111111111111111111111111111111111111112';
    const query = { inputMint: USDC, outputMint: SOL, publicKey: TAKER, amount: '5' };

    beforeEach(() => {
      swapBuildService.resolveSlippage.mockReturnValue({ slippageBps: 50 });
      swapBuildService.resolveAmount.mockResolvedValue({ amount: '5' });
      swapBuildService.build.mockResolvedValue({ transaction: 'AQID' });
    });

    it('answers 404 not_found when the stage switches the swap Powerup off', async () => {
      powerupCatalog.isOffered.mockReturnValueOnce(false);
      const res = createRes();

      await controller.build({ query }, res);

      expect(powerupCatalog.isOffered).toHaveBeenCalledWith('swap', 'solana-mainnet');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'not_found',
        error_description: 'Powerup swap is not available on solana-mainnet',
      });
      expect(swapBuildService.build).not.toHaveBeenCalled();
    });

    it('rejects missing required params before any service call', async () => {
      const res = createRes();
      await controller.build({ query: { inputMint: USDC } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'missing_parameter',
        error_description: 'Missing required query params: outputMint, publicKey',
      });
      expect(swapBuildService.build).not.toHaveBeenCalled();
    });

    it('rejects an invalid address, identical mints and a non-mainnet network', async () => {
      let res = createRes();
      await controller.build({ query: { ...query, publicKey: 'nope' } }, res);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_parameter',
        error_description: 'publicKey is not a valid Solana address',
      });

      res = createRes();
      await controller.build({ query: { ...query, outputMint: USDC } }, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error_description: 'inputMint and outputMint must differ' })
      );

      res = createRes();
      res.locals.network.id = 'solana-devnet';
      await controller.build({ query }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error_description: 'Swap is available on solana-mainnet only' })
      );
      expect(swapBuildService.build).not.toHaveBeenCalled();
    });

    it('propagates the 400 envelopes from slippage/amount resolution', async () => {
      swapBuildService.resolveAmount.mockResolvedValue({
        error: 'unknown_mint',
        error_description: 'x',
      });
      const res = createRes();
      await controller.build({ query }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'unknown_mint', error_description: 'x' });
      expect(swapBuildService.build).not.toHaveBeenCalled();
    });

    it('builds with the resolved amount/slippage, never forwarding fee params from the query', async () => {
      const res = createRes();
      await controller.build(
        {
          query: { ...query, uiAmount: '1', slippageBps: '100', swapFeeBps: '0', feeAccount: 'x' },
        },
        res
      );

      expect(swapBuildService.resolveSlippage).toHaveBeenCalledWith('100');
      expect(swapBuildService.build).toHaveBeenCalledWith(
        { inputMint: USDC, outputMint: SOL, publicKey: TAKER, amount: '5', slippageBps: 50 },
        res.locals
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith({ transaction: 'AQID' });
    });
  });
});
