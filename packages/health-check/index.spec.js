'use strict';

// The probe hits https://icanhazip.com/ for real. Left unmocked, this suite
// needed the network, which `test:unit` must not (CI runs it with no services
// and no secrets), and it asserted an IPv4-shaped answer — so it failed on any
// machine whose egress is IPv6. Mocking the transport keeps the coverage inside
// test:unit and makes the failure branches reachable at all.
jest.mock('https');

const { EventEmitter } = require('events');
const https = require('https');
const { healthCheck } = require('./index');

const mockReq = { headers: {}, connection: { remoteAddress: '127.0.0.1' } };

/** Drives https.get's callback with a response that emits `body` then ends. */
function respondWith(body) {
  https.get.mockImplementation((_url, callback) => {
    const response = new EventEmitter();
    callback(response);
    // The consumer attaches its listeners in an await continuation (a
    // microtask). setImmediate runs after all microtasks in every environment;
    // process.nextTick would fire BEFORE them in plain Node and hang.
    setImmediate(() => {
      response.emit('data', body);
      response.emit('end');
    });
    return response;
  });
}

/** Drives https.get's callback with a response that errors mid-stream. */
function failWith(message) {
  https.get.mockImplementation((_url, callback) => {
    const response = new EventEmitter();
    callback(response);
    setImmediate(() => response.emit('error', new Error(message)));
    return response;
  });
}

beforeEach(() => {
  https.get.mockReset();
});

describe('healthCheck', () => {
  it.each([
    ['an IPv4 address', '203.0.113.9\n', '203.0.113.9'],
    ['an IPv6 address', '2001:db8::1\n', '2001:db8::1'],
  ])('reports UP and the trimmed IP for %s', async (_label, body, expected) => {
    respondWith(body);

    await expect(healthCheck(mockReq)).resolves.toMatchObject({
      statusCode: 200,
      info: {
        app_state: 'UP',
        network: { internet: 'OK', ip: expected },
      },
    });
  });

  it('stays UP when the egress probe fails, and records why', async () => {
    failWith('socket hang up');

    const { statusCode, info } = await healthCheck(mockReq);

    // The probe calls a third party. Failing the health check on it let
    // someone else's outage pull a healthy instance out of the load balancer,
    // so its result is reported but no longer decides app_state.
    expect(statusCode).toBe(200);
    expect(info.app_state).toBe('UP');
    expect(info.network.internet).toBe('ERROR');
    expect(info.network.error).toBe('socket hang up');
    expect(info.network.ip).toBeUndefined();
  });

  it('resolves the client IP onto the payload', async () => {
    respondWith('203.0.113.9\n');

    const { info } = await healthCheck(mockReq);

    expect(info['x-forwarded-for']).toBe('127.0.0.1');
  });

  it('skips the redis probe when no connectors are supplied', async () => {
    respondWith('203.0.113.9\n');

    const { info } = await healthCheck(mockReq);

    expect(info.redis).toBeUndefined();
  });

  it('reports redis OK when the connector pings', async () => {
    respondWith('203.0.113.9\n');
    const connectors = { REDIS: { ping: jest.fn().mockResolvedValue('PONG') } };

    const { info } = await healthCheck(mockReq, connectors);

    expect(info.redis).toEqual({ status: 'OK' });
  });

  it('reports DOWN with a 500 when the redis ping fails', async () => {
    respondWith('203.0.113.9\n');
    const connectors = { REDIS: { ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) } };

    const { statusCode, info } = await healthCheck(mockReq, connectors);

    expect(statusCode).toBe(500);
    expect(info.app_state).toBe('DOWN');
    expect(info.redis).toEqual({ error: 'ECONNREFUSED' });
  });
});
