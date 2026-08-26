'use strict';

/**
 * Stake Program parser. Marks staking activity so the orchestrator emits
 * `STAKE_*` heliusType strings (matching Helius conventions) and the
 * resource decorator can bucket the tx as `stake`.
 *
 * Stake program instructions reported by parsed RPC:
 *   delegate, deactivate, withdraw, split, merge, initialize, authorize,
 *   setLockup, redelegate.
 *
 * The amount lives in CPI-emitted SOL transfers (System program), so the
 * inputs/outputs are already populated by the system parser. The stake
 * parser only sets the type hint.
 */

const STAKE_PROGRAM_ID = 'Stake11111111111111111111111111111111111111';

const STAKE_TYPES = new Set([
  'delegate',
  'redelegate',
  'authorize',
  'initialize',
  'split',
  'merge',
  'setLockup',
]);

const UNSTAKE_TYPES = new Set(['deactivate', 'withdraw']);

/**
 * Match native Stake program instructions and set `hasStake` (delegate,
 * split, merge, etc.) or `hasUnstake` (deactivate, withdraw). Unparsed
 * instructions default to `hasStake`. The SOL amount itself is captured by
 * the system parser from the instruction's CPI-emitted transfer.
 * @param {object} parsedIx - Parsed (or unparsed) RPC instruction for the Stake program
 * @param {object} ctx      - Orchestrator context (`{ building, ... }`)
 * @returns {void}
 */
const parse = (parsedIx, ctx) => {
  const type = parsedIx?.parsed?.type;
  if (!type) {
    ctx.building._hints.hasStake = true;
    return;
  }

  if (STAKE_TYPES.has(type)) {
    ctx.building._hints.hasStake = true;
    return;
  }

  if (UNSTAKE_TYPES.has(type)) {
    ctx.building._hints.hasUnstake = true;
  }
};

module.exports = {
  programIds: [STAKE_PROGRAM_ID],
  parse,
};
