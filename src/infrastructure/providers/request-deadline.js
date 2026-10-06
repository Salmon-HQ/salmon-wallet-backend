'use strict';

/**
 * Per-request time budget. The middleware stamps `res.locals.deadline` and
 * holds the same deadline in the request's async context; every provider
 * wait, timeout and retry reads `remainingMs(locals)` and stops before it.
 * A call deep in a service that has no `locals` to pass still gets the
 * request's deadline from the context — without it each such call started a
 * fresh 25 s budget and a hung provider held the request past API Gateway's
 * cut-off. Callers outside any request (jobs, tests) get a fresh default
 * budget so the same code path works there.
 *
 * Default 25 s: API Gateway gives up at 29 s.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const DEFAULT_BUDGET_MS = 25000;

const requestContext = new AsyncLocalStorage();

const budgetMs = () => Number(process.env.REQUEST_BUDGET_MS) || DEFAULT_BUDGET_MS;

const requestDeadline = (req, res, next) => {
  res.locals.deadline = Date.now() + budgetMs();
  requestContext.run({ deadline: res.locals.deadline }, next);
};

/**
 * @param {Object} [locals]
 * @returns {number} milliseconds left (may be ≤ 0 once spent).
 */
const remainingMs = (locals) => {
  const deadline = locals?.deadline ?? requestContext.getStore()?.deadline;
  return typeof deadline === 'number' ? deadline - Date.now() : budgetMs();
};

/**
 * @throws 503 `request_budget_exhausted` when nothing is left.
 * @returns {number} milliseconds left.
 */
const assertBudget = (locals) => {
  const remaining = remainingMs(locals);
  if (remaining <= 0) {
    const error = new Error('The request time budget is spent, please retry.');
    error.statusCode = 503;
    error.errorCode = 'request_budget_exhausted';
    throw error;
  }
  return remaining;
};

module.exports = { requestDeadline, remainingMs, assertBudget, DEFAULT_BUDGET_MS };
