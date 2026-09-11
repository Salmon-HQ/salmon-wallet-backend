'use strict';

/**
 * Generic Powerup build — adapter instructions → UNSIGNED v0 transaction
 * (`community-powerups` contract).
 *
 * Resolves the id against the registry and the stage flags, validates the
 * caller's params through the adapter, asks the adapter for instructions,
 * refuses any instruction that reaches a program the Powerup did not
 * declare, then compiles through the same step the swap uses
 * (`unsigned-transaction-builder`: priority fee, compute-unit limit,
 * simulation) with the caller as fee payer. A simulation error is a 422:
 * the user never pays to watch a transaction fail. Nothing here signs or
 * broadcasts (root `AGENTS.md` "Signing boundary").
 *
 * Fee policy: `salmonFee` is whatever the adapter reports (or null). The
 * swap's recipient resolution moves here with the first transaction-building
 * Powerup that has a fee leg.
 */

const { Connection } = require('@solana/web3.js');
const networkCapabilitiesService = require('../../shared/network-capabilities-service');
const {
  BUILD_TTL_MS,
  COMMITMENT,
  compileUnsigned,
} = require('../swap/unsigned-transaction-builder');
const { POWERUPS } = require('./registry');
const {
  PowerupError,
  PowerupNotFoundError,
  PowerupProgramMismatchError,
  PowerupSimulationError,
} = require('./powerup-errors');

/**
 * The registry entry for `id` when it is offered on `networkId`: registered,
 * enabled on the stage, declared for the network, and transaction-building.
 * Everything else — including `swap`, which has no adapter — is 404.
 * @throws {PowerupError} 404 `not_found`; 503 `network_catalog_unavailable`
 *   when the stage's powerups block is invalid
 */
const resolve = (id, networkId) => {
  const stagePowerups = networkCapabilitiesService.getPowerups();
  if (!stagePowerups) {
    throw new PowerupError(
      'The Powerup catalog is temporarily unavailable.',
      503,
      'network_catalog_unavailable'
    );
  }
  const entry = POWERUPS[id];
  const offered =
    entry && entry.adapter && entry.networks.includes(networkId) && stagePowerups[id]?.enabled;
  if (!offered) {
    throw new PowerupNotFoundError(id, networkId);
  }
  return entry;
};

/** Every program an instruction references must be in the Powerup's declared list. */
const assertDeclaredPrograms = (id, entry, instructions) => {
  const declared = new Set(entry.programIds || []);
  for (const ix of instructions) {
    const programId = ix.programId.toBase58();
    if (!declared.has(programId)) {
      console.error(
        '[POWERUP_PROGRAM_MISMATCH] adapter built an instruction for an undeclared program',
        {
          powerup: id,
          programId,
        }
      );
      throw new PowerupProgramMismatchError(id, programId);
    }
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
    throw new PowerupError(
      validated.error_description,
      400,
      validated.error === 'missing_parameter' ? 'missing_parameter' : 'invalid_parameter'
    );
  }

  const connection = new Connection(locals.network.config.nodeUrl, COMMITMENT);
  const result = await entry.adapter.build(validated.params, { locals, connection });
  assertDeclaredPrograms(id, entry, result.instructions);

  const built = await compileUnsigned({
    connection,
    payer: query.publicKey,
    instructions: result.instructions,
    lookupTableAddresses: result.lookupTableAddresses || [],
  });
  if (built.simulation.err) {
    throw new PowerupSimulationError(built.simulation);
  }

  return {
    transaction: built.transaction,
    expiresAt: new Date(Date.now() + BUILD_TTL_MS).toISOString(),
    provider: result.provider || null,
    salmonFee: result.salmonFee || null,
    contributor: entry.contributor,
    priorityFeeMicroLamports: built.priorityFeeMicroLamports,
    computeUnitLimit: built.computeUnitLimit,
    display: result.display || {},
  };
};

module.exports = { build };
