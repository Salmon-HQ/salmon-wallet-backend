'use strict';

const { healthCheck } = require('../../../packages/health-check');
const { name, version } = require('../../../package.json');
const { redis } = require('../../repositories/data-source');
const geoService = require('../../services/shared/geo-service');
const { resolveClientIp } = require('../../../packages/network-utils');

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

/**
 * Looks up geolocation info for the caller's IP via the geo service.
 *
 * @param {import('express').Request} req - Source of the caller's address.
 * @param {import('express').Response} res - Responds 200 with the ip-api.com payload
 *   on success. Upstream errors propagate to the final error middleware (500 with
 *   the standard `{ error, error_description }` envelope).
 * @returns {Promise<void>}
 */
const ip = async (req, res) => {
  const data = await geoService.getCallerGeo(resolveClientIp(req));
  res.status(200).send(data);
};

module.exports = {
  status,
  health,
  ip,
};
