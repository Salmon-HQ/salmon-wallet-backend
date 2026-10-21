'use strict';

jest.mock('../../../infrastructure/providers/circuit-breaker', () => ({
  check: jest.fn(),
  recordSuccess: jest.fn(),
  recordFailure: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../infrastructure/providers/shared-rate-limiter', () => ({
  acquire: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../../infrastructure/providers/metrics', () => ({ emit: jest.fn() }));

const breaker = require('../../../infrastructure/providers/circuit-breaker');
const limiter = require('../../../infrastructure/providers/shared-rate-limiter');
const { createBudgetedConnection } = require('../budgeted-connection');

describe('createBudgetedConnection', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  it('takes each call from the shared Triton budget behind its breaker', async () => {
    global.fetch = jest.fn(async (_url, init) => {
      const { id } = JSON.parse(init.body);
      return new global.Response(JSON.stringify({ jsonrpc: '2.0', id, result: 7 }));
    });
    const connection = createBudgetedConnection('https://rpc.example', {
      deadline: Date.now() + 10000,
      network: { environment: 'mainnet' },
    });

    await expect(connection.getSlot()).resolves.toBe(7);
    expect(breaker.check).toHaveBeenCalledWith('triton', 'mainnet', expect.any(Object));
    expect(limiter.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'triton' }),
      expect.any(Object)
    );
  });

  it('never reaches the node while the Triton breaker is open', async () => {
    const open = Object.assign(new Error('open'), {
      statusCode: 503,
      errorCode: 'upstream_unavailable',
    });
    breaker.check.mockRejectedValueOnce(open);
    global.fetch = jest.fn();
    const connection = createBudgetedConnection('https://rpc.example', {
      deadline: Date.now() + 10000,
    });

    await expect(connection.getSlot()).rejects.toMatchObject({ errorCode: 'upstream_unavailable' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('aborts each RPC call when the request budget runs out', async () => {
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const locals = { deadline: Date.now() + 50 };
    const connection = createBudgetedConnection('https://rpc.example', locals);

    const started = Date.now();
    await expect(connection.getSlot()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses to start a call once the budget is spent', async () => {
    global.fetch = jest.fn();
    const connection = createBudgetedConnection('https://rpc.example', {
      deadline: Date.now() - 1,
    });

    await expect(connection.getSlot()).rejects.toThrow(/time budget is spent/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not retry a 429 on its own', async () => {
    global.fetch = jest.fn(async () => new global.Response('Too Many Requests', { status: 429 }));
    const connection = createBudgetedConnection('https://rpc.example', {
      deadline: Date.now() + 10000,
    });

    await expect(connection.getSlot()).rejects.toThrow(/429/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
