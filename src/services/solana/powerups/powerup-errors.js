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

/** The runtime rejected the transaction; the user must not pay to watch it fail. */
class PowerupSimulationError extends PowerupError {
  constructor(simulation) {
    const reason =
      typeof simulation.err === 'string' ? simulation.err : JSON.stringify(simulation.err);
    super(`Transaction simulation failed: ${reason}`, 422, 'simulation_failed');
    this.logs = simulation.logs;
  }
}

module.exports = {
  PowerupError,
  PowerupNotFoundError,
  PowerupProgramMismatchError,
  PowerupSimulationError,
};
