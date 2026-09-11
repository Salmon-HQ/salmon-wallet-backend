'use strict';

/**
 * Per-request time budget. The middleware stamps `res.locals.deadline`;
 * every provider wait, timeout and retry reads `remainingMs(locals)` and
 * stops before it. Callers without locals (jobs, tests) get a fresh default
 * budget so the same code path works outside a request.
 *
 * Default 25 s: API Gateway gives up at 29 s.
 */

const DEFAULT_BUDGET_MS = 25000;

const budgetMs = () => Number(process.env.REQUEST_BUDGET_MS) || DEFAULT_BUDGET_MS;

const requestDeadline = (req, res, next) => {
  res.locals.deadline = Date.now() + budgetMs();
  next();
};

/**
 * @param {Object} [locals]
 * @returns {number} milliseconds left (may be ≤ 0 once spent).
 */
const remainingMs = (locals) =>
  typeof locals?.deadline === 'number' ? locals.deadline - Date.now() : budgetMs();

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
