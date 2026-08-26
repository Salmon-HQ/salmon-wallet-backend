'use strict';

jest.mock('../../../services/shared/network-catalog-service', () => ({
  list: jest.fn(),
}));

jest.mock('../../../resources/shared/network-resource', () =>
  jest.fn((network) => ({
    id: network.id,
    enabled: network.enabled,
  }))
);

const service = require('../../../services/shared/network-catalog-service');
const resource = require('../../../resources/shared/network-resource');
const controller = require('../network-controller');

describe('network-controller', () => {
  let res;

  beforeEach(() => {
    jest.clearAllMocks();
    res = {
      status: jest.fn(() => res),
      send: jest.fn(),
      json: jest.fn(),
    };
  });

  test('lists catalog entries through the resource layer', () => {
    service.list.mockReturnValue([
      { id: 'solana-mainnet', enabled: true },
      { id: 'ethereum-mainnet', enabled: false },
    ]);

    controller.list({}, res);

    expect(resource).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith([
      { id: 'solana-mainnet', enabled: true },
      { id: 'ethereum-mainnet', enabled: false },
    ]);
  });
});
