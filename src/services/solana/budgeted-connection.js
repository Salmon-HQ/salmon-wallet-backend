'use strict';

/**
 * A `@solana/web3.js` Connection bounded by the request's time budget.
 *
 * A plain Connection has no timeout and retries 429s on its own, so a node
 * that stops answering held the request past API Gateway's 29 s cut-off and
 * the wallet got a bare 504 instead of an error envelope. Each call here is
 * aborted when the request budget (`request-deadline`) runs out, refuses to
 * start once it is spent (503 `request_budget_exhausted`), and leaves 429s to
 * the caller.
 */

const { Connection } = require('@solana/web3.js');
const { assertBudget } = require('../../infrastructure/providers/request-deadline');

/**
 * @param {string} rpcUrl
 * @param {Object} locals - request locals carrying `deadline`.
 * @param {string} [commitment='confirmed']
 * @returns {Connection}
 */
const createBudgetedConnection = (rpcUrl, locals, commitment = 'confirmed') =>
  new Connection(rpcUrl, {
    commitment,
    disableRetryOnRateLimit: true,
    fetch: async (input, init) => {
      const remaining = assertBudget(locals);
      // An explicit timer, not AbortSignal.timeout: that one is unref'd and
      // never fires while the only pending work is this socket.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        return await fetch(input, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    },
  });

module.exports = { createBudgetedConnection };
