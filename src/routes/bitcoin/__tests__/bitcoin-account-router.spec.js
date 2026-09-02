'use strict';

const mockRouter = {
  get: jest.fn(),
  post: jest.fn(),
  param: jest.fn(),
};

jest.mock('express', () => ({
  Router: jest.fn(() => mockRouter),
}));
jest.mock('../../../../packages/api-utils', () => ({
  safe: jest.fn((handler) => ({ type: 'safe', handler })),
}));
jest.mock('../../../../packages/middleware', () => ({
  cacheControl: jest.fn((value) => ({ type: 'cacheControl', value })),
}));
jest.mock('../../../controllers/bitcoin/bitcoin-account-controller', () => ({
  listTransactions: 'listTransactions',
  listUtxo: 'listUtxo',
}));

describe('bitcoin-account-router', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRouter.get.mockClear();
    mockRouter.post.mockClear();
    mockRouter.param.mockClear();
  });

  it('answers 400 invalid_parameter for a malformed :address before any handler runs', () => {
    require('../bitcoin-account-router');

    const [name, handler] = mockRouter.param.mock.calls[0];
    expect(name).toBe('address');

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    handler({}, res, next, 'not-an-address');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_parameter' }));

    handler({}, res, next, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('exposes the read-only Bitcoin account surface (transactions, utxo)', () => {
    require('../bitcoin-account-router');

    expect(mockRouter.get).toHaveBeenCalledWith(
      '/:address/transactions',
      { type: 'cacheControl', value: 'no-cache' },
      { type: 'safe', handler: 'listTransactions' }
    );
    expect(mockRouter.get).toHaveBeenCalledWith(
      '/:address/utxo',
      { type: 'cacheControl', value: 'no-cache' },
      { type: 'safe', handler: 'listUtxo' }
    );
    // The wallet broadcasts signed transactions itself; the backend never
    // receives one.
    expect(mockRouter.post).not.toHaveBeenCalled();
  });
});
