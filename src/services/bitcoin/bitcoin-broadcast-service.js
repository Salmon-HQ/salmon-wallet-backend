'use strict';

/**
 * Bitcoin broadcast service.
 *
 * Broadcasts a signed Bitcoin transaction through Blockdaemon's universal
 * `/tx/send` endpoint and returns the provider response unchanged.
 */

const http = require('axios');
const blockdaemonClient = require('../../infrastructure/blockdaemon-client');

/**
 * Broadcasts a signed Bitcoin transaction via Blockdaemon's universal
 * `/tx/send` endpoint.
 *
 * @param {string} tx - raw signed transaction hex.
 * @param {{network: {blockchain: string, environment: string}}} locals
 *   - per-request locals used to build the upstream URL.
 * @returns {Promise<Object>} the provider response, returned unchanged.
 * @throws {Error} when the upstream broadcast request fails (e.g. invalid
 *   or already-broadcast transaction) — propagated from the HTTP client.
 */
// A broadcast has to reach the provider, which then relays to the network.
// The old 3s budget was shorter than the balance read's (6s) and routinely
// aborted a call that was still in flight.
const BROADCAST_TIMEOUT = 15000;

/**
 * True when the failure leaves the transaction's fate unknown: the request was
 * aborted locally, or the provider failed after accepting it. In both cases the
 * transaction may already be relayed, so reporting a plain failure invites the
 * user to rebuild and resend something that is possibly already in the mempool.
 */
const isIndeterminate = (error) =>
  error.code === 'ECONNABORTED' || !error.response || error.response.status >= 500;

const sendTransaction = async (tx, locals) => {
  const url = blockdaemonClient.getUniversalUrl(locals, '/tx/send');
  const payload = { tx };

  try {
    const { data } = await http.post(
      url,
      payload,
      blockdaemonClient.getRequestConfig({ timeout: BROADCAST_TIMEOUT })
    );

    return data;
  } catch (error) {
    if (!isIndeterminate(error)) {
      // A rejection the provider actually made (malformed tx, spent inputs...)
      // keeps its own status and message.
      throw error;
    }

    const indeterminate = new Error(
      'We could not confirm whether the transaction was broadcast. Check your transaction history before sending it again.'
    );
    indeterminate.statusCode = 502;
    indeterminate.errorCode = 'broadcast_status_unknown';
    throw indeterminate;
  }
};

module.exports = {
  sendTransaction,
};
