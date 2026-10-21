'use strict';

/**
 * A `@solana/web3.js` Connection whose every HTTP call goes through
 * `providerCall`: the request budget, the circuit breaker and the shared rate
 * limit apply exactly as they do to the axios provider calls.
 *
 * The profile follows the environment the request is for: `triton` where
 * Triton hosts it (`tritonClient.isConfigured`, the same test that picks the
 * URL in `constants/networks.js` and `triton-client.getRpcUrl`), otherwise
 * `solana-public`, the public cluster's own small bucket, so testnet traffic
 * never spends the Triton budget mainnet depends on.
 *
 * A plain Connection has no timeout, retries 429s on its own and resolves on
 * any HTTP status. Here each call refuses to start once the budget is spent
 * (503 `request_budget_exhausted`), while the breaker is open (503
 * `upstream_unavailable`) or when no shared token frees up (503
 * `upstream_rate_limited`); a 429 or 5xx answer is thrown with
 * `error.response.status` so the provider layer classifies it (a 5xx counts
 * toward the breaker, a 429 does not); and the body is read inside the call,
 * so a node trickling it is cut off at the deadline too.
 */

const { Connection } = require('@solana/web3.js');
const { providerCall } = require('../../infrastructure/providers/provider-client');
const tritonClient = require('../../infrastructure/triton-client');

const fetchBuffered = async (input, init, signal) => {
  const response = await fetch(input, { ...init, signal });
  const body = await response.arrayBuffer();
  if (response.status === 429 || response.status >= 500) {
    const error = new Error(`Solana RPC answered ${response.status}`);
    error.response = { status: response.status, headers: Object.fromEntries(response.headers) };
    throw error;
  }
  return new global.Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

/**
 * @param {string} rpcUrl
 * @param {Object} locals - request locals carrying `deadline` and
 *   `network.environment` (the cluster `rpcUrl` belongs to; default mainnet).
 * @param {string} [commitment='confirmed']
 * @returns {Connection}
 */
const createBudgetedConnection = (rpcUrl, locals, commitment = 'confirmed') => {
  const environment = locals?.network?.environment || 'mainnet';
  const profile = tritonClient.isConfigured(environment) ? 'triton' : 'solana-public';
  return new Connection(rpcUrl, {
    commitment,
    disableRetryOnRateLimit: true,
    fetch: (input, init) =>
      providerCall(profile, ({ signal }) => fetchBuffered(input, init, signal), {
        locals,
        environment,
        operationName: `${profile} RPC (connection)`,
      }),
  });
};

module.exports = { createBudgetedConnection };
