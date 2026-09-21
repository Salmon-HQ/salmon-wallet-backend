'use strict';

// `https` stays mocked so the assertion that nothing is fetched is real
// rather than incidental: an accidental reintroduction of an outbound call
// fails the suite instead of quietly reaching the network in CI.
jest.mock('https');

const https = require('https');
const { healthCheck } = require('./index');

const mockReq = { headers: {}, connection: { remoteAddress: '127.0.0.1' } };

beforeEach(() => {
  https.get.mockReset();
});

describe('healthCheck', () => {
  // Liveness answers from Redis alone. An outbound probe to a third party
  // cost every anonymous request a round trip and could never change the
  // verdict, so it must not be on this path at all.
  it('reports UP without making any outbound call', async () => {
    const { statusCode, info } = await healthCheck(mockReq);

    expect(statusCode).toBe(200);
    expect(info.app_state).toBe('UP');
    expect(info.network).toBeUndefined();
    expect(https.get).not.toHaveBeenCalled();
  });

  it('resolves the client IP onto the payload', async () => {

    const { info } = await healthCheck(mockReq);

    expect(info['x-forwarded-for']).toBe('127.0.0.1');
  });

  it('skips the redis probe when no connectors are supplied', async () => {

    const { info } = await healthCheck(mockReq);

    expect(info.redis).toBeUndefined();
  });

  it('reports redis OK when the connector pings', async () => {
    const connectors = { REDIS: { ping: jest.fn().mockResolvedValue('PONG') } };

    const { info } = await healthCheck(mockReq, connectors);

    expect(info.redis).toEqual({ status: 'OK' });
  });

  it('reports DOWN with a 500 when the redis ping fails', async () => {
    const connectors = { REDIS: { ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) } };

    const { statusCode, info } = await healthCheck(mockReq, connectors);

    expect(statusCode).toBe(500);
    expect(info.app_state).toBe('DOWN');
    expect(info.redis).toEqual({ error: 'ECONNREFUSED' });
  });
});
