'use strict';

jest.mock('../../constants/networks', () => [
  { id: 'solana-mainnet', blockchain: 'solana' },
  { id: 'bitcoin-mainnet', blockchain: 'bitcoin' },
]);

const multinetwork = require('../multinetwork');

const buildRes = () => {
  const res = {
    locals: {},
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
  };
  return res;
};

describe('multinetwork middleware', () => {
  test('attaches network to res.locals when networkId matches', async () => {
    const middleware = multinetwork();
    const req = { params: { networkId: 'solana-mainnet' } };
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.locals.network).toMatchObject({ id: 'solana-mainnet' });
    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBeNull();
  });

  test('returns 400 when networkId is unknown', async () => {
    const middleware = multinetwork();
    const req = { params: { networkId: 'fake-net' } };
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({
      error: 'bad_request',
      error_description: expect.stringContaining('Invalid network'),
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 400 when network is required and not provided', async () => {
    const middleware = multinetwork({ required: true });
    const req = { params: {} };
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({ error_description: 'Network required' });
  });

  test('passes when not required and no networkId', async () => {
    const middleware = multinetwork({ required: false });
    const req = { params: {} };
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBeNull();
  });

  test('skips to next route when blockchain not in allowed list', async () => {
    const middleware = multinetwork({ blockchains: ['solana'] });
    const req = { params: { networkId: 'bitcoin-mainnet' } };
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith('route');
    expect(res.locals.network).toBeUndefined();
  });

  test('proceeds when blockchain matches the allowed list', async () => {
    const middleware = multinetwork({ blockchains: ['solana'] });
    const req = { params: { networkId: 'solana-mainnet' } };
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.locals.network).toMatchObject({ id: 'solana-mainnet' });
  });

  test('reuses preset res.locals.network without re-resolving from networkId', async () => {
    const middleware = multinetwork();
    const preset = { id: 'preset-net', blockchain: 'foo' };
    const req = { params: { networkId: 'solana-mainnet' } };
    const res = buildRes();
    res.locals.network = preset;
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.locals.network).toBe(preset);
    expect(next).toHaveBeenCalledWith();
  });
});
