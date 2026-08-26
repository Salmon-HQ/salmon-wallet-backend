'use strict';

jest.mock('../../../../packages/api-utils', () => ({
  decorator: jest.fn(async (_resource, data) => data),
}));
jest.mock('../../../services/shared/bridge-service', () => ({
  available: jest.fn(),
  estimate: jest.fn(),
  minimal: jest.fn(),
  create: jest.fn(),
  getTransaction: jest.fn(),
}));

const bridgeService = require('../../../services/shared/bridge-service');
const controller = require('../bridge-controller');

describe('bridge-controller', () => {
  const buildRes = () => ({
    locals: {},
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('listAvailable delegates to service.available with query and decorates result', async () => {
    bridgeService.available.mockResolvedValue([{ symbol: 'BTC' }]);
    const res = buildRes();
    const req = { query: { symbol: 'SOL' } };

    await controller.listAvailable(req, res);

    expect(bridgeService.available).toHaveBeenCalledWith({ symbol: 'SOL' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith([{ symbol: 'BTC' }]);
  });

  it('listAvailable rejects a missing symbol instead of answering an empty list', async () => {
    const res = buildRes();

    await controller.listAvailable({ query: {} }, res);

    expect(bridgeService.available).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      error: 'missing_parameter',
      error_description: 'Missing required query params: symbol',
    });
  });

  it('getEstimate delegates to service.estimate and returns raw data', async () => {
    bridgeService.estimate.mockResolvedValue({ rate: '0.5' });
    const res = buildRes();
    const req = { query: { symbolIn: 'sol', symbolOut: 'btc', amount: '1' } };

    await controller.getEstimate(req, res);

    expect(bridgeService.estimate).toHaveBeenCalledWith({
      symbolIn: 'sol',
      symbolOut: 'btc',
      amount: '1',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ rate: '0.5' });
  });

  it('getMinimalAmountIn delegates to service.minimal', async () => {
    bridgeService.minimal.mockResolvedValue({ minAmount: '0.001' });
    const res = buildRes();
    const req = { query: { symbolIn: 'sol', symbolOut: 'btc' } };

    await controller.getMinimalAmountIn(req, res);

    expect(bridgeService.minimal).toHaveBeenCalledWith({ symbolIn: 'sol', symbolOut: 'btc' });
    expect(res.send).toHaveBeenCalledWith({ minAmount: '0.001' });
  });

  it('createExchange delegates to service.create', async () => {
    bridgeService.create.mockResolvedValue({ id: 'exchange-1' });
    const res = buildRes();
    const req = {
      query: { symbolIn: 'sol', symbolOut: 'btc', addressTo: 'btc-1', amount: '1' },
    };

    await controller.createExchange(req, res);

    expect(bridgeService.create).toHaveBeenCalledWith(req.query);
    expect(res.send).toHaveBeenCalledWith({ id: 'exchange-1' });
  });

  it('createExchangeFromBody delegates to service.create with the request body', async () => {
    bridgeService.create.mockResolvedValue({ id: 'exchange-2' });
    const res = buildRes();
    const req = {
      query: {},
      body: { symbolIn: 'sol', symbolOut: 'btc', amount: 1.5, addressTo: 'btc-1' },
    };

    await controller.createExchangeFromBody(req, res);

    expect(bridgeService.create).toHaveBeenCalledWith(req.body);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ id: 'exchange-2' });
  });

  it('createExchangeFromBody rejects an absent body instead of asking the provider', async () => {
    const res = buildRes();

    await controller.createExchangeFromBody({ query: {} }, res);

    expect(bridgeService.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'missing_parameter' }));
  });

  describe('parameter validation', () => {
    it.each([
      ['getEstimate', { query: { symbolIn: 'sol' } }, 'estimate'],
      ['getMinimalAmountIn', { query: { symbolIn: 'sol' } }, 'minimal'],
      ['getTransaction', { query: {} }, 'getTransaction'],
      ['createExchange', { query: { symbolIn: 'sol', symbolOut: 'btc' } }, 'create'],
    ])('%s answers 400 without calling the provider', async (handler, req, serviceMethod) => {
      const res = buildRes();

      await controller[handler](req, res);

      expect(bridgeService[serviceMethod]).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'missing_parameter' })
      );
    });

    it.each([['0'], ['-1'], ['abc']])(
      'rejects the non-positive amount %s on estimate',
      async (amount) => {
        const res = buildRes();

        await controller.getEstimate({ query: { symbolIn: 'sol', symbolOut: 'btc', amount } }, res);

        expect(bridgeService.estimate).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
      }
    );
  });

  it('getTransaction delegates to service.getTransaction and decorates the exchange', async () => {
    bridgeService.getTransaction.mockResolvedValue({ id: 'tx-1', status: 'confirmed' });
    const res = buildRes();
    const req = { query: { id: 'tx-1' } };

    await controller.getTransaction(req, res);

    expect(bridgeService.getTransaction).toHaveBeenCalledWith({ id: 'tx-1' });
    expect(res.send).toHaveBeenCalledWith({ id: 'tx-1', status: 'confirmed' });
  });
});
