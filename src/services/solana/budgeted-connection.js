'use strict';

/**
 * A `@solana/web3.js` Connection whose every HTTP call goes through
 * `providerCall('triton')`: the request budget, the Triton circuit breaker
 * and the shared Triton rate limit apply exactly as they do to the axios
 * Triton calls.
 *
 * A plain Connection has no timeout and retries 429s on its own, so a node
 * that stops answering held the request past API Gateway's 29 s cut-off and
 * the wallet got a bare 504 instead of an error envelope; and it bypassed the
 * shared limiter, so the bare-RPC history fallback could spend the paid
 * Triton quota unmetered. Each call here is aborted at the provider timeout
 * or the request deadline, refuses to start once the budget is spent (503
 * `request_budget_exhausted`), while the breaker is open (503
 * `upstream_unavailable`) or when no shared token frees up (503
 * `upstream_rate_limited`), and leaves 429s to the caller.
 */

const { Connection } = require('@solana/web3.js');
const { providerCall } = require('../../infrastructure/providers/provider-client');

/**
 * @param {string} rpcUrl
 * @param {Object} locals - request locals carrying `deadline` and `network`.
 * @param {string} [commitment='confirmed']
 * @returns {Connection}
 */
const createBudgetedConnection = (rpcUrl, locals, commitment = 'confirmed') =>
  new Connection(rpcUrl, {
    commitment,
    disableRetryOnRateLimit: true,
    fetch: (input, init) =>
      providerCall('triton', ({ signal }) => fetch(input, { ...init, signal }), {
        locals,
        operationName: 'Triton RPC (connection)',
      }),
  });

module.exports = { createBudgetedConnection };
