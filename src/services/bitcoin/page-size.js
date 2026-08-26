'use strict';

/**
 * Page-size bounds for the Blockdaemon-backed Bitcoin reads.
 *
 * The caller controls `pageSize`, and forwarding it verbatim went wrong in
 * both directions: a huge value made the upstream call exceed its own timeout
 * and surfaced as 500, while a tiny one turned the full UTXO walk into one
 * request per output, amplifying our traffic against the provider and risking
 * the Lambda budget. Clamping keeps a bad parameter from becoming an incident.
 */

const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 100;

/**
 * @param {string|number|undefined} pageSize
 * @returns {number} a page size inside [MIN_PAGE_SIZE, MAX_PAGE_SIZE].
 */
const clampPageSize = (pageSize) => {
  const parsed = Number(pageSize);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(parsed), MIN_PAGE_SIZE), MAX_PAGE_SIZE);
};

// Blockdaemon regularly needs over 3s for a busy address's history — measured
// at ~3.2s for a 100-item page — so the previous 3000ms budget turned normal
// upstream latency into a 500. Kept under the API Gateway ceiling (29s).
const READ_TIMEOUT = 10000;

module.exports = { clampPageSize, MIN_PAGE_SIZE, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, READ_TIMEOUT };
