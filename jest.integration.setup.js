'use strict';

/**
 * Integration suites only (`test:integration`). Every provider call goes
 * through the shared rate limiter and circuit breaker, which open the shared
 * Redis client; left open, it keeps Jest from exiting after the last suite.
 */

const { redis } = require('./src/repositories/data-source');

afterAll(async () => {
  if (redis.getClient().isOpen) await redis.quit();
});
