'use strict';

const { createBudgetedConnection } = require('../budgeted-connection');

describe('createBudgetedConnection', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
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
