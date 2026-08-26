'use strict';

jest.mock('../../../../packages/api-utils', () => ({
  decorator: jest.fn(async (_resource, data) => data),
}));
jest.mock('../../../services/multichain/account-service', () => ({
  getBalance: jest.fn(),
}));

const controller = require('../account-controller');
const service = require('../../../services/multichain/account-service');

describe('multichain account-controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates balance loading to multichain account-service and decorates the result', async () => {
    service.getBalance.mockResolvedValue([
      {
        owner: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        blockchain: 'bitcoin',
        amount: '100000000',
        decimals: 8,
        symbol: 'BTC',
        name: 'Bitcoin',
        type: 'native',
        address: 'btc',
        coingeckoId: 'bitcoin',
      },
    ]);

    const res = {
      locals: {
        network: { id: 'bitcoin-mainnet', blockchain: 'bitcoin' },
      },
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    const req = {
      params: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
      query: { tokens: 'true' },
    };

    await controller.showBalance(req, res);

    expect(service.getBalance).toHaveBeenCalledWith(
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      'true',
      res.locals
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith([
      expect.objectContaining({
        owner: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        symbol: 'BTC',
        coingeckoId: 'bitcoin',
      }),
    ]);
  });

  it.each([
    ['bitcoin', 'not-a-btc-address'],
    ['solana', 'not-a-solana-address!'],
  ])('answers 400 invalid_parameter for a malformed %s address', async (blockchain, address) => {
    const res = {
      locals: { network: { id: `${blockchain}-mainnet`, blockchain } },
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    };

    await controller.showBalance({ params: { address }, query: {} }, res);

    expect(service.getBalance).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_parameter' }));
  });
});
