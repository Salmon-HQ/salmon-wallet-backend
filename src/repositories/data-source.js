'use strict';

/**
 * Shared data-source singleton — the `redis` client every repository in
 * this tree requires from. Built once at module load from `process.env`
 * (connection host/port/credentials), so importing this module has the
 * side effect of opening connector configuration (the actual connection
 * is lazy/pooled by the underlying `@4m/redis-connector` package).
 */

const { reconnectStrategy } = require('../../packages/redis-connector/utils');

const Redis = require('../../packages/redis-connector');
const settings = {
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
    connectTimeout: process.env.REDIS_CONNECT_TIMEOUT
      ? Number(process.env.REDIS_CONNECT_TIMEOUT)
      : undefined,
    failFastLapse: process.env.REDIS_FAIL_FAST_LAPSE
      ? Number(process.env.REDIS_FAIL_FAST_LAPSE)
      : 0,
    reconnectStrategy: reconnectStrategy(
      process.env.REDIS_RECONNECT_MAX_RETRIES ? Number(process.env.REDIS_RECONNECT_MAX_RETRIES) : 0
    ),
  },
  password: process.env.REDIS_PASSWORD,
};
const redis = Redis(settings);

module.exports = { redis };
