const https = require('https');
const { isEmpty } = require('../object-utils');
const { resolveClientIp } = require('../network-utils');

const DATABASE_TYPES = {
  REDIS: 'REDIS',
};

const STATUS = {
  OK: 'OK',
  ERROR: 'ERROR',
};

const HEALTH = {
  UP: 'UP',
  DOWN: 'DOWN',
};

// Bound the probe: `https.get` has no default timeout, so a hung third party
// used to keep the health check open until the Lambda itself timed out.
const INTERNET_PROBE_TIMEOUT = 3000;

/**
 * Egress reachability probe.
 *
 * Informational only: its result no longer decides `app_state`. It calls a
 * third party we do not control, so letting it fail the health check meant
 * icanhazip having a bad day could take a perfectly healthy service out of the
 * load balancer.
 */
const internetStatus = async (info = {}) => {
  info.network = {};
  try {
    const clientRequest = await new Promise((resolve, reject) => {
      const request = https.get('https://icanhazip.com/', resolve);
      request.setTimeout(INTERNET_PROBE_TIMEOUT, () => {
        request.destroy(new Error('internet probe timed out'));
      });
      request.on('error', reject);
    });
    let data = await new Promise((resolve, reject) => {
      let response = '';
      clientRequest.on('data', (chunk) => (response += chunk));
      clientRequest.on('error', (err) => reject(err));
      clientRequest.on('end', () => resolve(response));
    });

    info.network.ip = data.trim();
    info.network.internet = STATUS.OK;
  } catch (error) {
    info.network.internet = STATUS.ERROR;
    info.network.error = error.message;
  }

  return undefined;
};

const shouldCheckConnection = (connectors, databaseType) => {
  return isEmpty(connectors) || !connectors[databaseType];
};

const checkRedisConnection = async (connectors, info = {}) => {
  if (shouldCheckConnection(connectors, DATABASE_TYPES.REDIS)) {
    return;
  }

  const connector = connectors[DATABASE_TYPES.REDIS];
  info.redis = {};
  let app_state;

  try {
    await connector.ping();
    app_state = HEALTH.UP;
    info.redis.status = STATUS.OK;
  } catch (error) {
    app_state = HEALTH.DOWN;
    info.redis.error = error.message;
  }

  return app_state;
};

const healthCheck = async (req, connectors) => {
  let statusCode = 200;
  let info = {};
  const promises = [];

  promises.push(internetStatus(info));
  promises.push(checkRedisConnection(connectors, info));

  const status = await Promise.all(promises);
  let app_state = HEALTH.UP;

  // for...in iterated INDICES here for years ('0' === 'DOWN' is never true),
  // so this endpoint could not report DOWN no matter what failed.
  if (status.includes(HEALTH.DOWN)) {
    app_state = HEALTH.DOWN;
    statusCode = 500;
  }

  info['x-forwarded-for'] = resolveClientIp(req);

  info = { app_state, ...info };

  return { statusCode, info };
};

module.exports = {
  healthCheck,
};
