'use strict';

const { healthCheck } = require('../../../packages/health-check');
const { name, version } = require('../../../package.json');
const { redis } = require('../../repositories/data-source');
const { countryOfRequest, databaseBuiltAt } = require('../../availability/country-resolver');

/** The country gate's view of this request, or nulls when its database cannot be opened. */
const geo = (req) => {
  try {
    return {
      country: countryOfRequest(req),
      countryDatabase: databaseBuiltAt().toISOString().slice(0, 10),
    };
  } catch {
    return { country: null, countryDatabase: null };
  }
};

/**
 * Returns basic service/build identification, plus the caller's country as
 * the availability gate places it and the date of the database it uses, so
 * the nightly check can tell a stale database and a tester behind a VPN can
 * see where the gate puts them.
 *
 * @param {import('express').Request} req - Its source address is placed by the gate.
 * @param {import('express').Response} res - Responds 200 with
 *   `{ name, version, build, commit, stage, time, country, countryDatabase }`.
 * @returns {Promise<void>}
 */
const status = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).send({
    name,
    version,
    build: process.env.GITHUB_RUN_ID,
    commit: process.env.GITHUB_SHA,
    stage: process.env.STAGE,
    time: new Date(),
    ...geo(req),
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
