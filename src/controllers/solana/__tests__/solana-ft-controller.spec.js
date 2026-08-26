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
jest.mock('../../../services/solana/solana-ft-swap-service', () => ({
  order: jest.fn(),
  execute: jest.fn(),
  resolveOrderAmount: jest.fn(),
}));
const controller = require('../solana-ft-controller');
const tokenService = require('../../../services/solana/solana-ft-service');
const swapService = require('../../../services/solana/solana-ft-swap-service');

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

  it('rejects swap order missing required base query params before service call', async () => {
    const res = createRes();
    await controller.order({ query: { inputMint: 'mint-in', outputMint: 'mint-out' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'missing_parameter',
      error_description: 'Missing required query params: publicKey',
    });
    expect(swapService.order).not.toHaveBeenCalled();
  });

  it('delegates uiAmount/amount resolution to swapService and forwards the resolved raw amount to order', async () => {
    swapService.resolveOrderAmount.mockResolvedValue({ amount: '1500000' });
    swapService.order.mockResolvedValue({ requestId: 'req-1' });
    const res = createRes();

    await controller.order(
      {
        query: {
          inputMint: 'mint-in',
          outputMint: 'mint-out',
          publicKey: 'wallet',
          uiAmount: '1.5',
        },
      },
      res
    );

    expect(swapService.resolveOrderAmount).toHaveBeenCalledWith(
      { amount: undefined, uiAmount: '1.5', inputMint: 'mint-in' },
      res.locals
    );
    expect(swapService.order).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '1500000', uiAmount: '1.5' }),
      res.locals
    );
  });

  it('propagates a 400 error envelope from swapService.resolveOrderAmount without calling order', async () => {
    swapService.resolveOrderAmount.mockResolvedValue({
      error: 'unknown_mint',
      error_description: 'Could not resolve decimals for inputMint=unknown-mint',
    });
    const res = createRes();

    await controller.order(
      {
        query: {
          inputMint: 'unknown-mint',
          outputMint: 'mint-out',
          publicKey: 'wallet',
          uiAmount: '1',
        },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'unknown_mint',
      error_description: 'Could not resolve decimals for inputMint=unknown-mint',
    });
    expect(swapService.order).not.toHaveBeenCalled();
  });

  it('still accepts raw amount as a backwards-compatible path', async () => {
    swapService.resolveOrderAmount.mockResolvedValue({ amount: '1000000' });
    swapService.order.mockResolvedValue({ requestId: 'req-1' });
    const res = createRes();

    await controller.order(
      {
        query: {
          inputMint: 'mint-in',
          outputMint: 'mint-out',
          publicKey: 'wallet',
          amount: '1000000',
        },
      },
      res
    );

    expect(swapService.resolveOrderAmount).toHaveBeenCalledWith(
      { amount: '1000000', uiAmount: undefined, inputMint: 'mint-in' },
      res.locals
    );
    expect(swapService.order).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '1000000' }),
      res.locals
    );
  });

  it('rejects swap execute missing required body fields before service call', async () => {
    const res = createRes();
    await controller.execute({ body: { requestId: 'req-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'missing_parameter',
      error_description: 'Missing required body fields: signedTransaction',
    });
    expect(swapService.execute).not.toHaveBeenCalled();
  });
});
