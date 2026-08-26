'use strict';

jest.mock('../../repositories/data-source', () => ({
  redis: {
    incr: jest.fn(),
    sendCommand: jest.fn(),
  },
}));

const { redis } = require('../../repositories/data-source');
const rateLimit = require('../rate-limit');

const buildReq = (overrides = {}) => ({
  requestContext: { identity: { sourceIp: '1.2.3.4' } },
  headers: {},
  socket: {},
  ...overrides,
});

const buildRes = () => {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  return res;
};

describe('rate-limit middleware', () => {
  const OLD_MODE = process.env.RATE_LIMIT_MODE;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.incr.mockResolvedValue(1);
    redis.sendCommand.mockResolvedValue(1);
    process.env.RATE_LIMIT_MODE = 'enforce';
  });

  afterAll(() => {
    process.env.RATE_LIMIT_MODE = OLD_MODE;
  });

  test('passes under the limit and sets EXPIRE on first hit', async () => {
    const middleware = rateLimit({ max: 5, windowSeconds: 60, prefix: 'test' });
    const next = jest.fn();
    await middleware(buildReq(), buildRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(redis.incr).toHaveBeenCalledWith(expect.stringMatching(/^rl:test:1\.2\.3\.4:\d+$/));
    expect(redis.sendCommand).toHaveBeenCalledWith(['EXPIRE', expect.any(String), '60']);
  });

  test('responds 429 with Retry-After when over the limit in enforce mode', async () => {
    redis.incr.mockResolvedValue(6);
    const middleware = rateLimit({ max: 5, windowSeconds: 60, prefix: 'test' });
    const next = jest.fn();
    const res = buildRes();
    await middleware(buildReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.payload).toMatchObject({ error: 'too_many_requests' });
    const retryAfter = Number(res.headers['Retry-After']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  test('passes when over the limit in log mode', async () => {
    process.env.RATE_LIMIT_MODE = 'log';
    redis.incr.mockResolvedValue(6);
    const middleware = rateLimit({ max: 5, windowSeconds: 60, prefix: 'test' });
    const next = jest.fn();
    await middleware(buildReq(), buildRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  test('off mode skips Redis entirely', async () => {
    process.env.RATE_LIMIT_MODE = 'off';
    const middleware = rateLimit({ max: 5, windowSeconds: 60, prefix: 'test' });
    const next = jest.fn();
    await middleware(buildReq(), buildRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  test('fails open on Redis error', async () => {
    redis.incr.mockRejectedValue(new Error('boom'));
    const middleware = rateLimit({ max: 5, windowSeconds: 60, prefix: 'test' });
    const next = jest.fn();
    await middleware(buildReq(), buildRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  test('fails open when Redis hangs past the timeout', async () => {
    redis.incr.mockImplementation(() => new Promise(() => {}));
    const middleware = rateLimit({ max: 5, windowSeconds: 60, prefix: 'test' });
    const next = jest.fn();
    await middleware(buildReq(), buildRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  test('uses the last x-forwarded-for entry when sourceIp is missing', async () => {
    const middleware = rateLimit({ max: 5, windowSeconds: 60, prefix: 'test' });
    const next = jest.fn();
    const req = buildReq({
      requestContext: undefined,
      headers: { 'x-forwarded-for': '9.9.9.9, 5.6.7.8' },
    });
    await middleware(req, buildRes(), next);
    expect(redis.incr).toHaveBeenCalledWith(expect.stringMatching(/^rl:test:5\.6\.7\.8:\d+$/));
    expect(next).toHaveBeenCalledWith();
  });

  test('passes without limiting when no IP is determinable', async () => {
    const middleware = rateLimit({ max: 5, windowSeconds: 60, prefix: 'test' });
    const next = jest.fn();
    const req = buildReq({ requestContext: undefined });
    await middleware(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(redis.incr).not.toHaveBeenCalled();
  });
});
