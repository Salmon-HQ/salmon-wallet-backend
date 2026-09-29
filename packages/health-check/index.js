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

  // Liveness reflects only what this service controls. The egress probe to a
  // third party was informational and never decided app_state, but it still
  // cost every anonymous GET /health an outbound call with a 3s worst case.
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
