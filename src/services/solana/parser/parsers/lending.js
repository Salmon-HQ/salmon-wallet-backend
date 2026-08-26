'use strict';

/**
 * Lending parser — Solend, Kamino Lend, MarginFi v2.
 *
 * Sets `hasLoan` so deriveType emits a Helius-shape LOAN type string
 * (`OFFER_LOAN`) which the resource decorator's HELIUS_TYPE_MAPPING already
 * routes to the LOAN bucket of the 9-bucket FE scheme.
 *
 * Distinguishing deposit (collateral) from borrow / repay / liquidate
 * requires decoding each program's IDL — punted to follow-up. The single
 * hint is enough to bucket these correctly today; the underlying token
 * transfers continue to populate inputs/outputs.
 */

const { SOURCES } = require('../program-sources');
const { createHintParser } = require('./_hint-parser');

module.exports = createHintParser({
  programIds: [...SOURCES.SOLEND, ...SOURCES.KAMINO, ...SOURCES.MARGINFI],
  hint: 'hasLoan',
});
