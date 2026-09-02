'use strict';

const errorHandler = require('../error-handler');

describe('error-handler middleware', () => {
  const buildRes = () => ({
    headersSent: false,
    removeHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  });

  const req = { method: 'GET', path: '/v1/bridge/transaction' };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('responds 500 server_error for an unexpected error', () => {
    const res = buildRes();

    errorHandler(new Error('boom'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'server_error',
      error_description: 'boom',
    });
    expect(res.removeHeader).toHaveBeenCalledWith('Cache-Control');
  });

  it('honors an explicit statusCode/errorCode carried by the error', () => {
    const res = buildRes();
    const err = Object.assign(new Error('not supported'), {
      statusCode: 422,
      errorCode: 'transfer_not_supported',
    });

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: 'transfer_not_supported',
      error_description: 'not supported',
    });
  });

  it('maps an upstream 400 to bad_request instead of masking it as 500', () => {
    const res = buildRes();
    const err = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { message: 'invalid transaction' } },
    });

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'bad_request',
      error_description: 'invalid transaction',
    });
  });

  it('maps an upstream 404 to not_found', () => {
    const res = buildRes();
    const err = Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404, data: {} },
    });

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'not_found',
      error_description: expect.any(String),
    });
  });

  it('maps an upstream 422 to unprocessable_entity', () => {
    const res = buildRes();
    const err = Object.assign(new Error('Request failed with status code 422'), {
      response: { status: 422, data: { description: 'pair not supported' } },
    });

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: 'unprocessable_entity',
      error_description: 'pair not supported',
    });
  });

  it('reads the reason out of a nested {err: {kind, details}} body', () => {
    const res = buildRes();
    const err = Object.assign(new Error('Request failed with status code 400'), {
      response: {
        status: 400,
        data: { err: { kind: 'InvalidAmount', details: 'Amount is out of range' } },
      },
    });

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'bad_request',
      error_description: 'Amount is out of range',
    });
  });

  it('keeps upstream auth/rate-limit/5xx failures as 500 (our problem, not the caller’s)', () => {
    [401, 403, 429, 500, 503].forEach((status) => {
      const res = buildRes();
      const err = Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data: { message: 'provider says no' } },
      });

      errorHandler(err, req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'server_error' }));
    });
  });

  it('never leaks a non-string upstream body into error_description', () => {
    const res = buildRes();
    const err = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { message: { nested: 'object' } } },
    });

    errorHandler(err, req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      error: 'bad_request',
      error_description: 'Request failed with status code 400',
    });
  });

  it('never logs provider credentials carried on the axios error', () => {
    const res = buildRes();
    const err = Object.assign(new Error('Request failed with status code 500'), {
      response: { status: 500, data: {} },
      config: {
        url: 'https://svc.blockdaemon.com/universal/v1/tx/send',
        headers: { 'X-API-Key': 'super-secret-key' },
      },
      request: { _header: 'POST /tx/send HTTP/1.1\r\nX-API-Key: super-secret-key\r\n\r\n' },
    });

    errorHandler(err, req, res, jest.fn());

    const logged = JSON.stringify(console.error.mock.calls);
    expect(logged).not.toContain('super-secret-key');
    expect(logged).not.toContain('X-API-Key');
    expect(console.error).toHaveBeenCalledWith(
      '[error-handler]',
      expect.objectContaining({ status: 500, upstreamUrl: expect.any(String) })
    );
  });

  it("logs the provider reason, not axios's opaque message, for client errors", () => {
    const res = buildRes();
    const err = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { err: { details: 'Amount is out of range' } } },
    });

    errorHandler(err, req, res, jest.fn());

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Amount is out of range'));
  });

  it('gives a malformed JSON body a client error code, not server_error', () => {
    const res = buildRes();
    // What express.json() raises: a 400 that carries no errorCode of its own.
    const err = Object.assign(new SyntaxError('Unexpected token } in JSON at position 4'), {
      statusCode: 400,
      status: 400,
      type: 'entity.parse.failed',
    });

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'bad_request' }));
  });

  it('does not hand the caller the provider IPs when the network fails', () => {
    const res = buildRes();
    // What axios raises when it cannot connect: no response, and a message
    // enumerating the upstream's addresses and ports.
    const err = Object.assign(
      new Error('connect ETIMEDOUT 172.64.144.197:443; connect ENETUNREACH 2606:4700::1:443'),
      { request: {}, code: 'ETIMEDOUT' }
    );

    errorHandler(err, req, res, jest.fn());

    const [, body] = res.json.mock.calls[0];
    const description = res.json.mock.calls[0][0].error_description;
    expect(description).not.toContain('172.64.144.197');
    expect(description).not.toContain('ETIMEDOUT');
    // Keeps a word the wallet's classifier reads as transient.
    expect(description).toContain('unavailable');
    expect(body).toBeUndefined();
  });

  it('delegates to express when headers were already sent', () => {
    const res = buildRes();
    res.headersSent = true;
    const next = jest.fn();
    const err = new Error('too late');

    errorHandler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});
