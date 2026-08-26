'use strict';

/**
 * Transform Jupiter Ultra API v1 execute response
 * Ultra API handles broadcasting automatically and returns execution status
 *
 * @param {Object} executeResult - Raw Ultra `/execute` response.
 * @returns {Promise<Object>} resource - passthrough of the fields below
 *   (see inline comments on the return statement for field meaning).
 */
module.exports = async (executeResult) => {
  const {
    status,
    code,
    signature,
    slot,
    error,
    totalInputAmount,
    totalOutputAmount,
    inputAmountResult,
    outputAmountResult,
    swapEvents,
  } = executeResult;

  return {
    status, // "Success" or "Failed"
    signature, // Transaction signature (on success)
    slot, // Blockchain slot number
    error, // Error message (on failure)
    totalInputAmount, // Total input token amount
    totalOutputAmount, // Total output token amount
    inputAmountResult, // Actual input processed
    outputAmountResult, // Actual output received
    swapEvents, // Multi-hop transaction details
    code, // Response code
  };
};
