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
const controller = require('../bitcoin-account-controller');
const transactionService = require('../../../services/bitcoin/bitcoin-transaction-service');
const utxoService = require('../../../services/bitcoin/bitcoin-utxo-service');

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

  it('exposes no broadcast action — the wallet broadcasts signed transactions itself', () => {
    expect(controller.sendTransaction).toBeUndefined();
  });
});
