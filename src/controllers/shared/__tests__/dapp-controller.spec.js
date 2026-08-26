'use strict';

jest.mock('../../../services/shared/dapp-service', () => ({
  getMetadata: jest.fn(),
}));

const service = require('../../../services/shared/dapp-service');
const controller = require('../dapp-controller');

describe('dapp-controller', () => {
  const buildRes = () => ({
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates the URL from req.query.url and forwards the metadata', async () => {
    service.getMetadata.mockResolvedValue({ name: 'Salmon', icon: 'https://example.com/icon.png' });
    const res = buildRes();

    await controller.showMetadata({ query: { url: 'https://salmon.example/' } }, res);

    expect(service.getMetadata).toHaveBeenCalledWith('https://salmon.example/');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ name: 'Salmon', icon: 'https://example.com/icon.png' });
  });

  it('propagates the missing-url error from the service', async () => {
    service.getMetadata.mockRejectedValue(new Error('Missing url query parameter'));
    const res = buildRes();

    await expect(controller.showMetadata({ query: {} }, res)).rejects.toThrow(
      'Missing url query parameter'
    );
    expect(res.status).not.toHaveBeenCalled();
  });
});
