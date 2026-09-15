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
const controller = require('../solana-ft-controller');
const tokenService = require('../../../services/solana/solana-ft-service');

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
});
