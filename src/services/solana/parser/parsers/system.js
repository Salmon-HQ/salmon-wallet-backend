'use strict';

/**
 * System program parser — extracts SOL transfers (lamport movements) from
 * parsed RPC instructions. The web3 parser already returns these as
 *
 *   { parsed: { type: 'transfer', info: { source, destination, lamports } },
 *     program: 'system',
 *     programId: '11111111111111111111111111111111' }
 *
 * so the parser is a thin extractor + delta into ctx.building.nativeTransfers.
 *
 * Other System program instructions we record but skip enriching:
 *   createAccount, allocate, assign, advanceNonce, withdrawNonce, etc.
 */

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

const TRANSFER_TYPES = new Set(['transfer', 'transferWithSeed']);

/**
 * Match System program `transfer`/`transferWithSeed` instructions and push
 * the lamport movement onto `ctx.building.nativeTransfers`. Other System
 * instruction types (createAccount, allocate, etc.) are no-ops here.
 * @param {object} parsedIx - Parsed RPC instruction for the System program
 * @param {object} ctx      - Orchestrator context (`{ building, ... }`)
 * @returns {void}
 */
const parse = (parsedIx, ctx) => {
  const parsed = parsedIx?.parsed;
  if (!parsed || parsed.type === undefined) return;

  if (TRANSFER_TYPES.has(parsed.type)) {
    const info = parsed.info || {};
    const lamports = info.lamports;
    if (lamports === undefined || lamports === null) return;

    ctx.building.nativeTransfers.push({
      fromUserAccount: info.source || info.from || null,
      toUserAccount: info.destination || info.to || null,
      amount: typeof lamports === 'string' ? Number(lamports) : lamports,
    });
  }
};

module.exports = {
  programIds: [SYSTEM_PROGRAM_ID],
  parse,
};
