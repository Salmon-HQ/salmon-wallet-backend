'use strict';

const {
  requestDeadline,
  remainingMs,
  assertBudget,
  DEFAULT_BUDGET_MS,
} = require('../request-deadline');

describe('request-deadline', () => {
  afterEach(() => delete process.env.REQUEST_BUDGET_MS);

  it('stamps res.locals.deadline with the configured budget', () => {
    process.env.REQUEST_BUDGET_MS = '1000';
    const res = { locals: {} };
    const next = jest.fn();
    const before = Date.now();
    requestDeadline({}, res, next);
    expect(res.locals.deadline).toBeGreaterThanOrEqual(before + 1000);
    expect(res.locals.deadline).toBeLessThan(before + 1100);
    expect(next).toHaveBeenCalled();
  });

  it('gives callers without locals a fresh default budget', () => {
    expect(remainingMs(undefined)).toBe(DEFAULT_BUDGET_MS);
    expect(assertBudget({})).toBe(DEFAULT_BUDGET_MS);
  });

  it('throws 503 request_budget_exhausted once the deadline passed', () => {
    expect(() => assertBudget({ deadline: Date.now() - 1 })).toThrow(
      expect.objectContaining({ statusCode: 503, errorCode: 'request_budget_exhausted' })
    );
  });

  it("bounds calls made without locals inside a request by that request's deadline", async () => {
    process.env.REQUEST_BUDGET_MS = '1000';
    const res = { locals: {} };
    let seen;
    requestDeadline({}, res, () => {
      setTimeout(() => {
        seen = remainingMs(undefined);
      }, 20);
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(seen).toBeLessThanOrEqual(1000 - 20);
    expect(seen).toBeGreaterThan(0);
  });
});
