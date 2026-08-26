'use strict';

jest.mock('../../../../packages/api-utils', () => ({
  decorator: jest.fn(async (_resource, data) => data),
}));
jest.mock('../../../services/bitcoin/bitcoin-transaction-service', () => ({
  getTransaction: jest.fn(),
  getTransactions: jest.fn(),
}));
jest.mock('../../../services/bitcoin/bitcoin-utxo-service', () => ({
  getUtxo: jest.fn(),
}));
jest.mock('../../../services/bitcoin/bitcoin-broadcast-service', () => ({
  sendTransaction: jest.fn(),
}));

const controller = require('../bitcoin-account-controller');
const transactionService = require('../../../services/bitcoin/bitcoin-transaction-service');
const utxoService = require('../../../services/bitcoin/bitcoin-utxo-service');
const broadcastService = require('../../../services/bitcoin/bitcoin-broadcast-service');

describe('bitcoin-account-controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const buildRes = () => ({
    locals: { network: { id: 'bitcoin-mainnet', blockchain: 'bitcoin' } },
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    json: jest.fn(),
  });

  it('delegates transaction history loading and decorates the result', async () => {
    transactionService.getTransactions.mockResolvedValue({
      data: [{ id: 'tx-1' }],
      meta: { nextPageToken: 'next-1' },
    });
    const res = buildRes();
    const req = { params: { address: 'btc-address' }, query: { pageSize: 10 } };

    await controller.listTransactions(req, res);

    expect(transactionService.getTransactions).toHaveBeenCalledWith(
      'btc-address',
      { pageSize: 10 },
      res.locals
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      data: [{ id: 'tx-1' }],
      meta: { nextPageToken: 'next-1' },
    });
  });

  it('delegates utxo loading and decorates the result', async () => {
    utxoService.getUtxo.mockResolvedValue({
      data: [{ id: 'utxo-1' }],
      meta: { nextPageToken: null },
    });
    const res = buildRes();
    const req = { params: { address: 'btc-address' }, query: { pageSize: 50 } };

    await controller.listUtxo(req, res);

    expect(utxoService.getUtxo).toHaveBeenCalledWith('btc-address', { pageSize: 50 }, res.locals);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      data: [{ id: 'utxo-1' }],
      meta: { nextPageToken: null },
    });
  });

  it('delegates broadcast to bitcoin-broadcast-service', async () => {
    broadcastService.sendTransaction.mockResolvedValue({ id: 'broadcast-id' });
    const res = buildRes();
    const req = { body: { tx: '0xdeadbeef' } };

    await controller.sendTransaction(req, res);

    expect(broadcastService.sendTransaction).toHaveBeenCalledWith('0xdeadbeef', res.locals);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ id: 'broadcast-id' });
  });

  it('sendTransaction returns 400 when tx body parameter is missing', async () => {
    const res = buildRes();

    await controller.sendTransaction({ body: {} }, res);

    expect(broadcastService.sendTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('sendTransaction returns 400 when body is undefined', async () => {
    const res = buildRes();

    await controller.sendTransaction({}, res);

    expect(broadcastService.sendTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('sendTransaction returns 400 when tx is not a string', async () => {
    const res = buildRes();

    await controller.sendTransaction({ body: { tx: 12345 } }, res);

    expect(broadcastService.sendTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
