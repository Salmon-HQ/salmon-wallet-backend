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
const { PublicKey, SystemProgram } = require('@solana/web3.js');
const { createBudgetedConnection } = require('../budgeted-connection');

const rpcAnswer = (result) =>
  jest.fn(async (_url, init) => {
    const { id } = JSON.parse(init.body);
    return new global.Response(JSON.stringify({ jsonrpc: '2.0', id, result }));
  });

// Testnet is never Triton-hosted, so its calls run on the public profile,
// which never retries: one answer per call keeps these tests exact.
const testnet = (budgetMs = 10000) => ({
  deadline: Date.now() + budgetMs,
  network: { environment: 'testnet' },
});

describe('createBudgetedConnection', () => {
  const realFetch = global.fetch;
  const savedTritonUrl = process.env.TRITON_RPC_URL;

  afterEach(() => {
    global.fetch = realFetch;
    if (savedTritonUrl === undefined) delete process.env.TRITON_RPC_URL;
    else process.env.TRITON_RPC_URL = savedTritonUrl;
    jest.clearAllMocks();
  });

  it('takes each call from the shared Triton budget behind its breaker', async () => {
    process.env.TRITON_RPC_URL = 'https://tenant.solana-mainnet.rpcpool.com/token';
    global.fetch = rpcAnswer(7);
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

  // The public cluster is not Triton: drawing its calls from the Triton
  // bucket let one address paging testnet history starve mainnet for all.
  it('runs a testnet history page on its own public budget', async () => {
    global.fetch = rpcAnswer([]);
    const connection = createBudgetedConnection('https://api.testnet.solana.com', testnet());

    await expect(
      connection.getSignaturesForAddress(new PublicKey(SystemProgram.programId), { limit: 25 })
    ).resolves.toEqual([]);
    expect(limiter.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'solana-public' }),
      expect.any(Object)
    );
    expect(limiter.acquire).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'triton' }),
      expect.anything()
    );
  });

  it('never reaches the node while the breaker is open', async () => {
    const open = Object.assign(new Error('open'), {
      statusCode: 503,
      errorCode: 'upstream_unavailable',
    });
    breaker.check.mockRejectedValueOnce(open);
    global.fetch = jest.fn();
    const connection = createBudgetedConnection('https://rpc.example', testnet());

    await expect(connection.getSlot()).rejects.toMatchObject({ errorCode: 'upstream_unavailable' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // fetch resolves on any status, so without this a node answering 5xx was
  // recorded as a success and the breaker never opened.
  it('counts a 5xx answer against the breaker', async () => {
    global.fetch = jest.fn(async () => new global.Response('down', { status: 503 }));
    const connection = createBudgetedConnection('https://rpc.example', testnet());

    await expect(connection.getSlot()).rejects.toThrow(/503/);
    expect(breaker.recordFailure).toHaveBeenCalledWith(
      'solana-public',
      'testnet',
      expect.any(Object)
    );
    expect(breaker.recordSuccess).not.toHaveBeenCalled();
  });

  it('treats a 429 as the throttle it is: no success, no outage', async () => {
    global.fetch = jest.fn(async () => new global.Response('Too Many Requests', { status: 429 }));
    const connection = createBudgetedConnection('https://rpc.example', testnet());

    await expect(connection.getSlot()).rejects.toThrow(/429/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(breaker.recordSuccess).not.toHaveBeenCalled();
    expect(breaker.recordFailure).not.toHaveBeenCalled();
  });

  it('aborts each RPC call when the request budget runs out', async () => {
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const connection = createBudgetedConnection('https://rpc.example', testnet(50));

    const started = Date.now();
    await expect(connection.getSlot()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // The headers arriving is not the end of the call: a node trickling its
  // body must still be cut off at the deadline.
  it('reads the body inside the deadline', async () => {
    global.fetch = jest.fn(async (_url, init) => {
      const body = new global.ReadableStream({
        start(controller) {
          controller.enqueue(new global.TextEncoder().encode('{"jsonrpc":'));
          init.signal.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new global.Response(body, { status: 200 });
    });
    const connection = createBudgetedConnection('https://rpc.example', testnet(50));

    const started = Date.now();
    await expect(connection.getSlot()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses to start a call once the budget is spent', async () => {
    global.fetch = jest.fn();
    const connection = createBudgetedConnection('https://rpc.example', testnet(-1));

    await expect(connection.getSlot()).rejects.toThrow(/time budget is spent/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
