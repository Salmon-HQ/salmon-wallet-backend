'use strict';

const { healthCheck } = require('../../../packages/health-check');
const { name, version } = require('../../../package.json');
const { redis } = require('../../repositories/data-source');

/**
 * Returns basic service/build identification.
 *
 * @param {import('express').Request} req - Unused; response is derived from package
 *   metadata and env vars.
 * @param {import('express').Response} res - Responds 200 with
 *   `{ name, version, build, commit, stage, time }`.
 * @returns {Promise<void>}
 */
const status = async (req, res) => {
  res.status(200).send({
    name,
    version,
    build: process.env.GITHUB_RUN_ID,
    commit: process.env.GITHUB_SHA,
    stage: process.env.STAGE,
    time: new Date(),
  });
};

/**
 * Runs the dependency health check (Redis) and reports status.
 *
 * @param {import('express').Request} req - Passed through to `healthCheck`.
 * @param {import('express').Response} res - Responds with the status code and info
 *   payload returned by `healthCheck` (200 when healthy, non-200 otherwise).
 * @returns {Promise<void>}
 */
const health = async (req, res) => {
  let { statusCode, info } = await healthCheck(req, { REDIS: redis });

  res.status(statusCode).send(info);
};

module.exports = {
  status,
  health,
};
