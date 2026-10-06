'use strict';

/**
 * Page-size bounds for the Bitcoin history reads.
 *
 * The caller controls `pageSize`, and forwarding it verbatim went wrong in
 * both directions: a huge value made the upstream call exceed its own timeout
 * and surfaced as 500. Each page of 25 confirmed transactions upstream is one
 * more request, so the ceiling also bounds our traffic per call. Clamping keeps a bad parameter from becoming an incident.
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

module.exports = { clampPageSize, MIN_PAGE_SIZE, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE };
