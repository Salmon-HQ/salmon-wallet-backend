'use strict';

/**
 * Generic Powerup build — adapter instructions → UNSIGNED v0 transaction
 * (`community-powerups` contract).
 *
 * Resolves the id through the catalog predicate (registry ∩ stage flags ∩
 * declared + enabled network ∩ has an adapter), validates the caller's params
 * through the adapter, asks the adapter for instructions, compiles through
 * the same step the swap uses (`unsigned-transaction-builder`: lookup
 * tables, priority fee, compute-unit limit, simulation) with the caller as
 * fee payer, then refuses the bytes unless every top-level program of the
 * COMPILED message (lookup tables resolved) is one the Powerup declared or
 * the compute budget we prepend. A declared program is trusted with
 * everything it can CPI into; simulation proves the transaction executes,
 * not what it invoked. A runtime rejection is a 422 (the user never pays to
 * watch a transaction fail); an RPC outage during simulation is a 503, not
 * the caller's fault. Nothing here signs or broadcasts (root `AGENTS.md`
 * "Signing boundary").
 *
 * Fees: `salmonFee` is forced to null in this feature (see `registry.js`).
 */

const { Connection } = require('@solana/web3.js');
const {
  ALWAYS_ALLOWED_PROGRAMS,
  BUILD_TTL_MS,
  COMMITMENT,
  compileUnsigned,
} = require('../swap/unsigned-transaction-builder');
const { POWERUPS } = require('./registry');
const powerupCatalog = require('./powerup-catalog-service');
const {
  PowerupError,
  PowerupNotFoundError,
  PowerupProgramMismatchError,
  PowerupSimulationError,
} = require('./powerup-errors');

/**
 * The registry entry for `id` when it is offered on `networkId` (catalog
 * predicate) and transaction-building. Everything else — including `swap`,
 * which has no adapter — is 404.
 * @throws {PowerupError} 404 `not_found`; 503 `network_catalog_unavailable`
 *   when the stage config is invalid
 */
const resolve = (id, networkId) => {
  const entry = POWERUPS[id];
  if (!entry?.adapter || !powerupCatalog.isOffered(id, networkId)) {
    throw new PowerupNotFoundError(id, networkId);
  }
  return entry;
};

/** Validation codes the adapter may answer with, beyond the two generic ones. */
const validationError = (entry, { error, error_description: description }) => {
  const passThrough = ['missing_parameter', ...(entry.errorCodes || [])];
  const code = passThrough.includes(error) ? error : 'invalid_parameter';
  return new PowerupError(description, 400, code);
};

/** An adapter may only name the lookup tables its entry declared. */
const assertDeclaredLookupTables = (id, entry, addresses) => {
  const declared = new Set(entry.lookupTables || []);
  const undeclared = addresses.find((address) => !declared.has(address));
  if (undeclared) {
    console.error('[POWERUP_PROGRAM_MISMATCH] adapter named an undeclared lookup table', {
      powerup: id,
      lookupTable: undeclared,
    });
    throw new PowerupProgramMismatchError(id, `lookup table ${undeclared}`);
  }
};

/** Every top-level program of the compiled message must be declared, or the compute budget. */
const assertDeclaredPrograms = (id, entry, programIds) => {
  const allowed = new Set([...ALWAYS_ALLOWED_PROGRAMS, ...(entry.programIds || [])]);
  const undeclared = programIds.find((programId) => !allowed.has(programId));
  if (undeclared) {
    console.error('[POWERUP_PROGRAM_MISMATCH] compiled message invokes an undeclared program', {
      powerup: id,
      programId: undeclared,
    });
    throw new PowerupProgramMismatchError(id, undeclared);
  }
};

/**
 * @param {string} id - Powerup id (path segment)
 * @param {Object} query - raw query params; `publicKey` is already validated by the controller
 * @param {Object} locals - request locals (`network`)
 * @returns {Promise<Object>} build result consumed by `solana-powerup-build-resource`
 */
const build = async (id, query, locals) => {
  const entry = resolve(id, locals.network.id);

  const validated = entry.adapter.validate(query);
  if (validated.error) {
    throw validationError(entry, validated);
  }

  const connection = new Connection(locals.network.config.nodeUrl, COMMITMENT);
  const result = await entry.adapter.build(validated.params, { locals, connection });
  const lookupTableAddresses = result.lookupTableAddresses || [];
  assertDeclaredLookupTables(id, entry, lookupTableAddresses);

  const built = await compileUnsigned({
    connection,
    payer: query.publicKey,
    instructions: result.instructions,
    lookupTableAddresses,
    simulationFallback: false,
  });
  assertDeclaredPrograms(id, entry, built.programIds);
  if (built.simulation.err) {
    throw new PowerupSimulationError(built.simulation);
  }

  return {
    transaction: built.transaction,
    expiresAt: new Date(Date.now() + BUILD_TTL_MS).toISOString(),
    provider: result.provider || null,
    salmonFee: null,
    contributor: entry.contributor,
    priorityFeeMicroLamports: built.priorityFeeMicroLamports,
    computeUnitLimit: built.computeUnitLimit,
    display: result.display || {},
  };
};

module.exports = { build };
