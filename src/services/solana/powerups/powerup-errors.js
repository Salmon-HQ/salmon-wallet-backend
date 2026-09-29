'use strict';

/** Powerup-domain error carrying the status + code the error middleware renders. */
class PowerupError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/** The id is not offered here: unknown, disabled, read-only, or not declared for this network. */
class PowerupNotFoundError extends PowerupError {
  constructor(id, networkId) {
    super(`Powerup ${id} is not available on ${networkId}`, 404, 'not_found');
  }
}

/** An instruction reaches a program the Powerup never declared; refuse to return the bytes. */
class PowerupProgramMismatchError extends PowerupError {
  constructor(id, programId) {
    super(
      `Powerup ${id} built an instruction for undeclared program ${programId}`,
      502,
      'provider_program_mismatch'
    );
  }
}

/** The compiled message needs a signature besides the caller's; the wallet could never complete it. */
class PowerupSignerMismatchError extends PowerupError {
  constructor(id, requiredSignatures) {
    super(
      `Powerup ${id} built a transaction requiring ${requiredSignatures} signatures; only the caller may sign`,
      502,
      'provider_signer_mismatch'
    );
  }
}

/**
 * The simulation did not pass. A runtime rejection is the transaction's
 * fault (422 `simulation_failed`: the user must not pay to watch it fail); an
 * RPC transport failure is ours (503 `simulation_unavailable`).
 */
class PowerupSimulationError extends PowerupError {
  constructor(simulation) {
    const reason =
      typeof simulation.err === 'string' ? simulation.err : JSON.stringify(simulation.err);
    if (simulation.transport) {
      super(`Transaction simulation unavailable: ${reason}`, 503, 'simulation_unavailable');
    } else {
      super(`Transaction simulation failed: ${reason}`, 422, 'simulation_failed');
    }
    this.logs = simulation.logs;
  }
}

module.exports = {
  PowerupError,
  PowerupNotFoundError,
  PowerupProgramMismatchError,
  PowerupSignerMismatchError,
  PowerupSimulationError,
};
